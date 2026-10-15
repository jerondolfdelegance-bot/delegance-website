// Delegance team tools: chat (#team, client groups, direct + group messages), people directory, updates log, roadmap.
import { now, uid, json, bad, clean, parse, body, can, audit, limited, SEEN } from './_lib.js';
import { notify } from './_crm.js';

const TEAM_ROLES = "('staff','admin','super_admin')";
const person = u => ({ id: u.id, name: u.name, role: u.role, title: u.title || null, avatar: u.avatar || null, accent: u.accent || null });

// Which client groups can this person see? Team: every client with a portal user or a VA. VA: their clients. Client: their own.
async function clientIds(env, me) {
  const DB = env.DB;
  if (can(me, 'staff')) {
    const { results } = await DB.prepare(`SELECT c.id, c.name, c.company FROM crm_contacts c WHERE (c.id IN (SELECT contact_id FROM users WHERE contact_id IS NOT NULL AND role = 'client') OR c.id IN (SELECT contact_id FROM va_assignments)) AND ${SEEN('c')} ORDER BY c.name LIMIT 300`).bind(me.id).all();
    return results;
  }
  if (me.role === 'va') return (await DB.prepare('SELECT c.id, c.name, c.company FROM va_assignments a JOIN crm_contacts c ON c.id = a.contact_id WHERE a.va_id = ? ORDER BY c.name').bind(me.id).all()).results;
  if (me.role === 'client' && me.contact_id) return (await DB.prepare('SELECT id, name, company FROM crm_contacts WHERE id = ?').bind(me.contact_id).all()).results;
  return [];
}
async function canSee(env, me, cid) {
  if (cid === 'team') return can(me, 'staff');
  if (cid.startsWith('cl_')) {
    const id = cid.slice(3);
    if (can(me, 'staff')) return !!(await env.DB.prepare(`SELECT 1 FROM crm_contacts c WHERE c.id = ? AND ${SEEN('c')}`).bind(id, me.id).first());
    if (me.role === 'client') return me.contact_id === id;
    if (me.role === 'va') return !!(await env.DB.prepare('SELECT 1 FROM va_assignments WHERE va_id = ? AND contact_id = ?').bind(me.id, id).first());
    return false;
  }
  return !!(await env.DB.prepare('SELECT 1 FROM chat_members WHERE channel_id = ? AND user_id = ?').bind(cid, me.id).first());
}
async function members(env, cid) {
  const DB = env.DB;
  if (cid === 'team') return (await DB.prepare(`SELECT * FROM users WHERE role IN ${TEAM_ROLES} AND status = 'active' ORDER BY name`).all()).results;
  if (cid.startsWith('cl_')) {
    const id = cid.slice(3);
    return (await DB.prepare(`SELECT * FROM users WHERE status = 'active' AND ((role = 'client' AND contact_id = ?) OR id IN (SELECT va_id FROM va_assignments WHERE contact_id = ?) OR role IN ${TEAM_ROLES}) ORDER BY role IN ${TEAM_ROLES}, name`).bind(id, id).all()).results;
  }
  return (await DB.prepare("SELECT u.* FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.channel_id = ? ORDER BY u.name").bind(cid).all()).results;
}

export async function teamRoutes(path, m, req, env, me) {
  const DB = env.DB, p = path.split('/');
  if (me.via === 'key') return null;

  // ---------- People directory (who you can message) ----------
  if (path === 'people' && m === 'GET') {
    const sql = can(me, 'staff') ? "SELECT * FROM users WHERE status = 'active' AND role IN ('staff','admin','super_admin','va','client') ORDER BY name"
      : `SELECT * FROM users WHERE status = 'active' AND (role IN ${TEAM_ROLES} OR id IN (SELECT va_id FROM va_assignments WHERE contact_id = ?) OR (role = 'client' AND contact_id IN (SELECT contact_id FROM va_assignments WHERE va_id = ?))) ORDER BY name`;
    const { results } = can(me, 'staff') ? await DB.prepare(sql).all() : await DB.prepare(sql).bind(me.contact_id || '', me.id).all();
    return json({ items: results.filter(u => u.id !== me.id).map(u => ({ ...person(u), bio: u.bio || null })) });
  }

  // ---------- Chat ----------
  if (p[0] === 'chat') {
    if (!['staff', 'admin', 'super_admin', 'va', 'client'].includes(me.role)) return bad('Chat is for the Delegance team, VAs and clients.', 403);
    if (!p[1] && m === 'GET') {
      const list = [];
      if (can(me, 'staff')) list.push({ id: 'team', kind: 'team', name: 'team', topic: 'Everyone on the Delegance team' });
      for (const c of await clientIds(env, me)) list.push({ id: 'cl_' + c.id, kind: 'client', name: c.company || c.name, topic: 'Client group: ' + (c.company ? c.name + ', ' : '') + 'their VAs and Delegance' });
      const { results: own } = await DB.prepare('SELECT ch.* FROM chat_members cm JOIN chat_channels ch ON ch.id = cm.channel_id WHERE cm.user_id = ? ORDER BY ch.created_at DESC LIMIT 200').bind(me.id).all();
      if (own.length) {
        const ids = own.map(c => c.id);
        const { results: mem } = await DB.prepare(`SELECT cm.channel_id, u.id, u.name, u.avatar, u.role, u.accent, u.title FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.channel_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
        for (const c of own) {
          const others = mem.filter(x => x.channel_id === c.id && x.id !== me.id);
          list.push({ id: c.id, kind: c.kind, name: c.name || others.map(o => o.name.split(' ')[0]).join(', ') || 'Just you', people: others.map(person) });
        }
      }
      if (!list.length) return json({ channels: [] });
      const ids = list.map(c => c.id), marks = ids.map(() => '?').join(',');
      const [{ results: unread }, { results: last }] = await Promise.all([
        DB.prepare(`SELECT m.channel_id, COUNT(*) n FROM chat_messages m LEFT JOIN chat_reads r ON r.channel_id = m.channel_id AND r.user_id = ? WHERE m.channel_id IN (${marks}) AND m.user_id != ? AND m.created_at > COALESCE(r.last_read, '') GROUP BY m.channel_id`).bind(me.id, ...ids, me.id).all(),
        DB.prepare(`SELECT m.channel_id, m.body, m.created_at, u.name FROM chat_messages m JOIN users u ON u.id = m.user_id WHERE m.id IN (SELECT (SELECT id FROM chat_messages x WHERE x.channel_id = c.cid ORDER BY x.created_at DESC LIMIT 1) FROM (SELECT value cid FROM json_each(?)) c)`).bind(JSON.stringify(ids)).all(),
      ]);
      for (const c of list) {
        c.unread = (unread.find(u => u.channel_id === c.id) || {}).n || 0;
        const l = last.find(x => x.channel_id === c.id);
        c.last = l ? { body: l.body.slice(0, 120), at: l.created_at, name: l.name } : null;
      }
      list.sort((a, b) => (a.kind === 'team' ? -1 : b.kind === 'team' ? 1 : 0) || String((b.last || {}).at || '').localeCompare(String((a.last || {}).at || '')));
      return json({ channels: list });
    }
    if (p[1] === 'unread' && m === 'GET') {
      const r = await teamRoutes('chat', 'GET', req, env, me);
      const d = await r.json();
      return json({ unread: (d.channels || []).reduce((n, c) => n + c.unread, 0) });
    }
    if (p[1] === 'new' && m === 'POST') {
      const b = await body(req);
      const want = [...new Set((Array.isArray(b.user_ids) ? b.user_ids : []).map(String))].filter(id => id !== me.id).slice(0, 30);
      if (!want.length) return bad('Pick at least one person.');
      const ok = await (await teamRoutes('people', 'GET', req, env, me)).json();
      const allowed = new Set(ok.items.map(u => u.id));
      if (!want.every(id => allowed.has(id))) return bad('You can only message people you work with.', 403);
      if (want.length === 1) {
        const ex = await DB.prepare("SELECT ch.id FROM chat_channels ch WHERE ch.kind = 'dm' AND (SELECT COUNT(*) FROM chat_members x WHERE x.channel_id = ch.id) = 2 AND EXISTS (SELECT 1 FROM chat_members a WHERE a.channel_id = ch.id AND a.user_id = ?) AND EXISTS (SELECT 1 FROM chat_members b WHERE b.channel_id = ch.id AND b.user_id = ?)").bind(me.id, want[0]).first();
        if (ex) return json({ id: ex.id });
      }
      const id = uid('ch_'), kind = want.length === 1 ? 'dm' : 'group';
      await DB.batch([DB.prepare('INSERT INTO chat_channels (id, kind, name, created_by, created_at) VALUES (?,?,?,?,?)').bind(id, kind, kind === 'group' ? clean(b.name, 60) || null : null, me.id, now()),
        ...[me.id, ...want].map(u => DB.prepare('INSERT INTO chat_members (channel_id, user_id) VALUES (?,?)').bind(id, u))]);
      return json({ id }, 201);
    }
    const cid = p[1] || '';
    if (!/^(team|cl_[a-z0-9_]{3,40}|ch_[a-f0-9]{20})$/.test(cid) || !(await canSee(env, me, cid))) return bad('Chat not found.', 404);
    if (!p[2] && m === 'GET') {
      const url = new URL(req.url), after = url.searchParams.get('after');
      const rows = after
        ? (await DB.prepare('SELECT * FROM chat_messages WHERE channel_id = ? AND created_at > ? ORDER BY created_at LIMIT 200').bind(cid, after).all()).results
        : (await DB.prepare('SELECT * FROM (SELECT * FROM chat_messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT 150) ORDER BY created_at').bind(cid).all()).results;
      const ppl = await members(env, cid), byId = Object.fromEntries(ppl.map(u => [u.id, u]));
      const missing = [...new Set(rows.map(r => r.user_id).filter(id => !byId[id]))];
      if (missing.length) for (const u of (await DB.prepare(`SELECT * FROM users WHERE id IN (${missing.map(() => '?').join(',')})`).bind(...missing).all()).results) byId[u.id] = u;
      await DB.prepare('INSERT INTO chat_reads (channel_id, user_id, last_read) VALUES (?,?,?) ON CONFLICT(channel_id, user_id) DO UPDATE SET last_read = excluded.last_read').bind(cid, me.id, now()).run();
      return json({ messages: rows.map(r => ({ id: r.id, body: r.body, at: r.created_at, mine: r.user_id === me.id, from: byId[r.user_id] ? person(byId[r.user_id]) : { name: 'Former member' } })), members: after ? undefined : ppl.map(person) });
    }
    if (!p[2] && m === 'POST') {
      if (await limited(env, 'chat:' + me.id, 240, 3600)) return bad('You are sending messages very fast. Please wait a moment.', 429);
      const b = await body(req), text = clean(b.body, 4000);
      if (!text) return bad('Type a message first.');
      const id = uid('cm_'), t = now();
      await DB.batch([DB.prepare('INSERT INTO chat_messages (id, channel_id, user_id, body, created_at) VALUES (?,?,?,?,?)').bind(id, cid, me.id, text, t),
        DB.prepare('INSERT INTO chat_reads (channel_id, user_id, last_read) VALUES (?,?,?) ON CONFLICT(channel_id, user_id) DO UPDATE SET last_read = excluded.last_read').bind(cid, me.id, t)]);
      // Notify: everyone in a direct/group chat; in #team and client groups only people @mentioned by first name or full name.
      const ppl = (await members(env, cid)).filter(u => u.id !== me.id);
      const low = text.toLowerCase();
      const targets = cid.startsWith('ch_') ? ppl : low.includes('@everyone') && can(me, 'staff') ? ppl : ppl.filter(u => low.includes('@' + u.name.toLowerCase()) || low.includes('@' + u.name.split(' ')[0].toLowerCase()));
      if (targets.length) await notify(env, targets.map(u => u.id), { title: `${me.name.split(' ')[0]}: ${text.slice(0, 80)}`, body: cid === 'team' ? '#team' : cid.startsWith('cl_') ? 'Client group' : 'Direct message', link: '#chat/' + cid });
      return json({ id, at: t }, 201);
    }
    if (p[2] === 'leave' && m === 'POST' && cid.startsWith('ch_')) {
      await DB.prepare('DELETE FROM chat_members WHERE channel_id = ? AND user_id = ?').bind(cid, me.id).run();
      return json({ ok: true });
    }
    if (p[2] && m === 'DELETE') {
      const r = await DB.prepare('DELETE FROM chat_messages WHERE id = ? AND channel_id = ? AND (user_id = ? OR ? = 1)').bind(p[2], cid, me.id, can(me, 'admin') ? 1 : 0).run();
      return r.meta.changes ? json({ ok: true }) : bad('You can only delete your own messages.', 403);
    }
    return null;
  }

  // ---------- Updates log + roadmap (team reads, super admin writes) ----------
  if (p[0] === 'updates' || p[0] === 'roadmap') {
    if (!can(me, 'staff')) return bad('Not allowed.', 403);
    const T = p[0] === 'updates' ? 'product_updates' : 'roadmap';
    if (!p[1] && m === 'GET') {
      const { results } = await DB.prepare(T === 'roadmap' ? 'SELECT * FROM roadmap ORDER BY status = \'done\', sort, updated_at DESC' : 'SELECT * FROM product_updates ORDER BY released_at DESC, id DESC').all();
      return json({ items: results, can_edit: can(me, 'super_admin') });
    }
    if (!can(me, 'super_admin')) return bad('Only super admins can change this.', 403);
    const b = m === 'DELETE' ? {} : await body(req);
    if (T === 'roadmap') {
      const f = { title: clean(b.title, 120), body: clean(b.body, 1000) || null, status: ['planned', 'in_progress', 'done'].includes(b.status) ? b.status : 'planned', area: clean(b.area, 40) || null, sort: Math.round(+b.sort) || 0 };
      if (m !== 'DELETE' && !f.title) return bad('Give it a title.');
      if (!p[1] && m === 'POST') { await DB.prepare('INSERT INTO roadmap (id, title, body, status, area, sort, updated_at) VALUES (?,?,?,?,?,?,?)').bind(uid('rm_'), f.title, f.body, f.status, f.area, f.sort, now()).run(); return json({ ok: true }, 201); }
      if (p[1] && m === 'PATCH') { await DB.prepare('UPDATE roadmap SET title = ?, body = ?, status = ?, area = ?, sort = ?, updated_at = ? WHERE id = ?').bind(f.title, f.body, f.status, f.area, f.sort, now(), p[1]).run(); return json({ ok: true }); }
    } else {
      const f = { version: clean(b.version, 30) || null, title: clean(b.title, 120), body: clean(b.body, 3000), released_at: /^\d{4}-\d{2}-\d{2}$/.test(b.released_at || '') ? b.released_at : now().slice(0, 10) };
      if (m !== 'DELETE' && (!f.title || !f.body)) return bad('Add a title and what changed.');
      if (!p[1] && m === 'POST') { await DB.prepare('INSERT INTO product_updates (id, version, title, body, released_at, created_at) VALUES (?,?,?,?,?,?)').bind(uid('up_'), f.version, f.title, f.body, f.released_at, now()).run(); return json({ ok: true }, 201); }
      if (p[1] && m === 'PATCH') { await DB.prepare('UPDATE product_updates SET version = ?, title = ?, body = ?, released_at = ? WHERE id = ?').bind(f.version, f.title, f.body, f.released_at, p[1]).run(); return json({ ok: true }); }
    }
    if (p[1] && m === 'DELETE') { await DB.prepare(`DELETE FROM ${T} WHERE id = ?`).bind(p[1]).run(); await audit(env, me.email, T + '.delete', p[1]); return json({ ok: true }); }
  }
  return null;
}
