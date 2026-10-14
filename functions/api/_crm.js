// Delegance CRM v2: deals, activities, reports, search, notifications, templates, bulk + import.
import { now, uid, json, bad, clean, cleanEmail, parse, body, can, audit, sendEmail, limited } from './_lib.js';

export const DEAL_STAGES = ['new', 'contacted', 'call', 'proposal', 'negotiation', 'won', 'lost'];
export const STAGE_PROB = { new: 10, contacted: 20, call: 40, proposal: 60, negotiation: 80, won: 100, lost: 0 };
const STAGE_NAME = { new: 'New', contacted: 'Contacted', call: 'Discovery call', proposal: 'Proposal sent', negotiation: 'Negotiation', won: 'Won', lost: 'Lost' };
const KINDS = ['note', 'call', 'meeting', 'email'];
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const money = v => (v === '' || v == null || !Number.isFinite(+v)) ? null : Math.max(0, Math.round(+v));

// In-app notifications (the bell). Never throws.
export async function notify(env, userIds, { title, body: text, link }) {
  try {
    const ids = [...new Set((userIds || []).filter(Boolean))];
    if (!ids.length) return;
    const t = now();
    await env.DB.batch(ids.map(u => env.DB.prepare('INSERT INTO notifications (id, user_id, title, body, link, created_at) VALUES (?,?,?,?,?,?)').bind(uid('nf_'), u, String(title).slice(0, 140), text ? String(text).slice(0, 300) : null, link || null, t)));
  } catch (e) { console.error('notify', e && e.message); }
}
export async function adminIds(env) {
  const { results } = await env.DB.prepare("SELECT id FROM users WHERE role IN ('admin','super_admin') AND status = 'active'").all();
  return results.map(r => r.id);
}
export async function logActivity(env, { contact_id, deal_id, me, kind = 'system', body: text, visibility = 'internal' }) {
  const t = now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO crm_notes (id, contact_id, deal_id, author_id, author_name, visibility, kind, body, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(uid('nt_'), contact_id || '', deal_id || null, me ? me.id : null, me ? me.name : 'Delegance', visibility, kind, String(text).slice(0, 3000), t),
    ...(contact_id ? [env.DB.prepare('UPDATE crm_contacts SET last_activity = ?, updated_at = ? WHERE id = ?').bind(t, t, contact_id)] : []),
    ...(deal_id ? [env.DB.prepare('UPDATE crm_deals SET updated_at = ? WHERE id = ?').bind(t, deal_id)] : []),
  ]);
}
export async function newDeal(env, { title, contact_id, owner_id, stage = 'new', value_usd = null, source = null, close_date = null }) {
  const id = uid('dl_'), t = now();
  await env.DB.prepare('INSERT INTO crm_deals (id, title, contact_id, owner_id, stage, value_usd, close_date, source, created_at, updated_at, stage_changed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, title, contact_id || null, owner_id || null, DEAL_STAGES.includes(stage) ? stage : 'new', value_usd, close_date, source, t, t, t).run();
  return id;
}

// Returns a Response, or null when the path is not ours.
export async function crmRoutes(path, m, req, env, me, url, later) {
  const DB = env.DB, p = path.split('/');
  if (!can(me, 'staff')) return null;

  // ----- Deals -----
  if (p[0] === 'deals') {
    if (!p[1] && m === 'GET') {
      const mine = url.searchParams.get('mine') === '1';
      const { results } = await DB.prepare(`SELECT d.*, c.name contact_name, c.company, u.name owner_name,
          (SELECT MAX(created_at) FROM crm_notes n WHERE n.deal_id = d.id) last_note
        FROM crm_deals d LEFT JOIN crm_contacts c ON c.id = d.contact_id LEFT JOIN users u ON u.id = d.owner_id
        ${mine ? 'WHERE d.owner_id = ?' : ''} ORDER BY d.updated_at DESC LIMIT 1000`).bind(...(mine ? [me.id] : [])).all();
      return json({ items: results.map(dealOut), stages: DEAL_STAGES.map(s => ({ id: s, name: STAGE_NAME[s], probability: STAGE_PROB[s] })) });
    }
    if (!p[1] && m === 'POST') {
      const b = await body(req); const title = clean(b.title, 140);
      if (!title) return bad('Give the deal a name.');
      let contact = b.contact_id || null;
      if (!contact && clean(b.contact_name, 120)) contact = (await DB.prepare('INSERT INTO crm_contacts (id, name, company, email, source, stage, kind, owner_id, tags, created_at, updated_at, last_activity) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id')
        .bind(uid('ct_'), clean(b.contact_name, 120), clean(b.company, 120) || null, cleanEmail(b.email) || null, 'Manual', 'new', 'lead', me.id, '[]', now(), now(), now()).first()).id;
      const id = await newDeal(env, { title, contact_id: contact, owner_id: b.owner_id || me.id, stage: b.stage, value_usd: money(b.value_usd), source: clean(b.source, 60) || 'Manual', close_date: isDate(b.close_date) ? b.close_date : null });
      await logActivity(env, { contact_id: contact, deal_id: id, me, body: `Deal created: ${title}.` });
      return json({ ok: true, id }, 201);
    }
    const d = p[1] && await DB.prepare('SELECT * FROM crm_deals WHERE id = ?').bind(p[1]).first();
    if (!d) return bad('Deal not found.', 404);
    if (!p[2] && m === 'GET') {
      const [c, notes, tasks, team] = await Promise.all([
        d.contact_id ? DB.prepare('SELECT id, name, company, email, phone, kind FROM crm_contacts WHERE id = ?').bind(d.contact_id).first() : null,
        DB.prepare('SELECT * FROM crm_notes WHERE deal_id = ? OR (contact_id = ? AND deal_id IS NULL AND ? != \'\') ORDER BY created_at DESC LIMIT 200').bind(d.id, d.contact_id || '', d.contact_id || '').all(),
        DB.prepare('SELECT t.*, u.name assignee_name FROM crm_tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.deal_id = ? ORDER BY t.status = \'done\', t.due IS NULL, t.due').bind(d.id).all(),
        DB.prepare("SELECT id, name, role FROM users WHERE role IN ('staff','admin','super_admin','va') AND status = 'active' ORDER BY name").all(),
      ]);
      const owner = d.owner_id ? await DB.prepare('SELECT name FROM users WHERE id = ?').bind(d.owner_id).first() : null;
      return json({ deal: dealOut({ ...d, owner_name: owner && owner.name, contact_name: c && c.name, company: c && c.company }), contact: c, notes: notes.results, tasks: tasks.results, team: team.results, stages: DEAL_STAGES.map(s => ({ id: s, name: STAGE_NAME[s], probability: STAGE_PROB[s] })) });
    }
    if (!p[2] && m === 'PATCH') {
      const b = await body(req), f = { ...d }, t = now();
      if (b.title !== undefined) f.title = clean(b.title, 140) || d.title;
      if (b.value_usd !== undefined) f.value_usd = money(b.value_usd);
      if (b.probability !== undefined) f.probability = b.probability === '' || b.probability == null ? null : Math.min(100, Math.max(0, Math.round(+b.probability) || 0));
      if (b.close_date !== undefined) f.close_date = isDate(b.close_date) ? b.close_date : null;
      if (b.owner_id !== undefined) f.owner_id = b.owner_id || null;
      if (b.lost_reason !== undefined) f.lost_reason = clean(b.lost_reason, 200) || null;
      const moved = DEAL_STAGES.includes(b.stage) && b.stage !== d.stage;
      if (moved) { f.stage = b.stage; f.stage_changed_at = t; f.closed_at = ['won', 'lost'].includes(b.stage) ? t : null; }
      await DB.prepare('UPDATE crm_deals SET title=?, value_usd=?, probability=?, close_date=?, owner_id=?, lost_reason=?, stage=?, stage_changed_at=?, closed_at=?, updated_at=? WHERE id=?')
        .bind(f.title, f.value_usd, f.probability, f.close_date, f.owner_id, f.lost_reason, f.stage, f.stage_changed_at, f.closed_at, t, d.id).run();
      if (moved) {
        await logActivity(env, { contact_id: d.contact_id, deal_id: d.id, me, body: `Moved "${f.title}" from ${STAGE_NAME[d.stage]} to ${STAGE_NAME[f.stage]}${f.stage === 'lost' && f.lost_reason ? ' (' + f.lost_reason + ')' : ''}.` });
        if (f.stage === 'won' && d.contact_id) await DB.prepare("UPDATE crm_contacts SET kind = 'client', stage = 'won' WHERE id = ?").bind(d.contact_id).run();
        if (f.stage === 'won') later(notify(env, await adminIds(env), { title: `Deal won: ${f.title}`, body: `${me.name} won ${f.value_usd ? 'US$' + f.value_usd.toLocaleString() : 'a deal'}.`, link: '#deal/' + d.id }));
      }
      if (b.owner_id && b.owner_id !== d.owner_id && b.owner_id !== me.id) later(notify(env, [b.owner_id], { title: `${me.name} gave you a deal`, body: f.title, link: '#deal/' + d.id }));
      return json({ ok: true });
    }
    if (!p[2] && m === 'DELETE' && can(me, 'admin')) {
      await DB.batch([DB.prepare('DELETE FROM crm_deals WHERE id = ?').bind(d.id), DB.prepare('UPDATE crm_notes SET deal_id = NULL WHERE deal_id = ?').bind(d.id), DB.prepare('UPDATE crm_tasks SET deal_id = NULL WHERE deal_id = ?').bind(d.id)]);
      await audit(env, me.email, 'crm.deal_delete', d.title);
      return json({ ok: true });
    }
    return null;
  }

  // ----- Activities: note / call / meeting on a contact or deal -----
  if (path === 'activities' && m === 'POST') {
    const b = await body(req), text = clean(b.body, 3000), kind = KINDS.includes(b.kind) && b.kind !== 'email' ? b.kind : 'note';
    if (!text) return bad('Write something first.');
    let contact = b.contact_id || null;
    if (b.deal_id) { const d = await DB.prepare('SELECT contact_id FROM crm_deals WHERE id = ?').bind(b.deal_id).first(); if (!d) return bad('Deal not found.', 404); contact = contact || d.contact_id; }
    if (!contact) return bad('Pick a contact or deal.');
    await logActivity(env, { contact_id: contact, deal_id: b.deal_id || null, me, kind, body: text, visibility: b.visibility === 'client' ? 'client' : 'internal' });
    // @mentions: "@Kenneth" pings that teammate
    const names = [...text.matchAll(/@([A-Za-z][\w.-]{1,30})/g)].map(x => x[1].toLowerCase());
    if (names.length) {
      const { results } = await DB.prepare("SELECT id, name FROM users WHERE role IN ('staff','admin','super_admin','va') AND status = 'active'").all();
      const ids = results.filter(u => u.id !== me.id && names.some(n => u.name.toLowerCase().split(' ')[0] === n || u.name.toLowerCase().replace(/\s+/g, '') === n)).map(u => u.id);
      later(notify(env, ids, { title: `${me.name} mentioned you`, body: text.slice(0, 200), link: b.deal_id ? '#deal/' + b.deal_id : '#contact/' + contact }));
    }
    return json({ ok: true }, 201);
  }

  // ----- Send an email to a contact from the CRM (logged on the timeline) -----
  if (p[0] === 'contacts' && p[2] === 'email' && m === 'POST') {
    const c = await DB.prepare('SELECT * FROM crm_contacts WHERE id = ?').bind(p[1]).first();
    if (!c) return bad('Contact not found.', 404);
    if (!c.email) return bad('This contact has no email address.');
    if (await limited(env, 'crmmail:' + me.id, 60, 3600)) return bad('That is a lot of emails this hour. Please wait a little.', 429);
    const b = await body(req), subject = clean(b.subject, 160), text = clean(b.body, 8000);
    if (!subject || !text) return bad('Add a subject and a message.');
    const fill = s => s.replace(/\{\{\s*first_name\s*\}\}/gi, c.name.split(' ')[0]).replace(/\{\{\s*name\s*\}\}/gi, c.name).replace(/\{\{\s*company\s*\}\}/gi, c.company || 'your business').replace(/\{\{\s*my_name\s*\}\}/gi, me.name);
    const ok = await sendEmail(env, { to: c.email, subject: fill(subject), title: fill(subject), intro: fill(text), outro: `${me.name}${me.title ? ', ' + me.title : ''} · Delegance. Just reply to this email to answer.`, replyTo: me.email });
    if (!ok) return bad('The email could not be sent. Please try again in a minute.', 502);
    await logActivity(env, { contact_id: c.id, deal_id: b.deal_id || null, me, kind: 'email', body: `Email sent: ${fill(subject)}\n\n${fill(text)}` });
    return json({ ok: true });
  }
  if (p[0] === 'templates') {
    if (!p[1] && m === 'GET') { const { results } = await DB.prepare('SELECT id, name, subject, body FROM email_templates ORDER BY name').all(); return json({ items: results }); }
    if (!p[1] && m === 'POST') {
      const b = await body(req), name = clean(b.name, 80), subject = clean(b.subject, 160), text = clean(b.body, 8000);
      if (!name || !subject || !text) return bad('A template needs a name, subject and message.');
      await DB.prepare('INSERT INTO email_templates (id, name, subject, body, created_by, created_at) VALUES (?,?,?,?,?,?)').bind(uid('tp_'), name, subject, text, me.id, now()).run();
      return json({ ok: true }, 201);
    }
    if (p[1] && m === 'DELETE') { await DB.prepare('DELETE FROM email_templates WHERE id = ?').bind(p[1]).run(); return json({ ok: true }); }
  }

  // ----- Bulk actions + import -----
  if (path === 'contacts/bulk' && m === 'POST') {
    const b = await body(req), ids = (Array.isArray(b.ids) ? b.ids : []).map(String).slice(0, 500);
    if (!ids.length) return bad('Select some contacts first.');
    const marks = ids.map(() => '?').join(',');
    if (b.action === 'owner') await DB.prepare(`UPDATE crm_contacts SET owner_id = ?, updated_at = ? WHERE id IN (${marks})`).bind(b.value || null, now(), ...ids).run();
    else if (b.action === 'kind' && ['lead', 'client', 'partner'].includes(b.value)) await DB.prepare(`UPDATE crm_contacts SET kind = ?, updated_at = ? WHERE id IN (${marks})`).bind(b.value, now(), ...ids).run();
    else if (b.action === 'tag' || b.action === 'untag') {
      const tag = clean(b.value, 30); if (!tag) return bad('Type a tag.');
      const { results } = await DB.prepare(`SELECT id, tags FROM crm_contacts WHERE id IN (${marks})`).bind(...ids).all();
      await DB.batch(results.map(r => { let t = parse(r.tags, []); t = b.action === 'tag' ? [...new Set([...t, tag])].slice(0, 12) : t.filter(x => x !== tag); return DB.prepare('UPDATE crm_contacts SET tags = ? WHERE id = ?').bind(JSON.stringify(t), r.id); }));
    } else if (b.action === 'delete' && can(me, 'admin')) {
      await DB.batch(['crm_notes', 'crm_requests', 'va_assignments'].map(t => DB.prepare(`DELETE FROM ${t} WHERE contact_id IN (${marks})`).bind(...ids)).concat([
        DB.prepare(`UPDATE crm_deals SET contact_id = NULL WHERE contact_id IN (${marks})`).bind(...ids), DB.prepare(`UPDATE users SET contact_id = NULL WHERE contact_id IN (${marks})`).bind(...ids), DB.prepare(`DELETE FROM crm_contacts WHERE id IN (${marks})`).bind(...ids)]));
      await audit(env, me.email, 'crm.bulk_delete', ids.length + ' contacts');
    } else return bad('Unknown action.');
    return json({ ok: true, count: ids.length });
  }
  if (path === 'contacts/import' && m === 'POST') {
    const b = await body(req), rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 2000);
    if (!rows.length) return bad('The file has no rows.');
    const { results: existing } = await DB.prepare('SELECT LOWER(email) e FROM crm_contacts WHERE email IS NOT NULL').all();
    const seen = new Set(existing.map(x => x.e)), t = now(), stmts = [];
    let skipped = 0;
    for (const r of rows) {
      const name = clean(r.name, 120), email = cleanEmail(r.email);
      if (!name || (email && seen.has(email))) { skipped++; continue; }
      if (email) seen.add(email);
      const tags = String(r.tags || '').split(/[;|]/).map(x => clean(x, 30)).filter(Boolean).slice(0, 12);
      stmts.push(DB.prepare('INSERT INTO crm_contacts (id, name, company, email, phone, country, source, stage, kind, owner_id, tags, created_at, updated_at, last_activity) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(uid('ct_'), name, clean(r.company, 120) || null, email || null, clean(r.phone, 40) || null, clean(r.country, 60) || null, clean(r.source, 60) || 'Import', 'new', ['client', 'partner'].includes(r.kind) ? r.kind : 'lead', me.id, JSON.stringify(tags), t, t, t));
    }
    for (let i = 0; i < stmts.length; i += 50) await DB.batch(stmts.slice(i, i + 50));
    await audit(env, me.email, 'crm.import', `${stmts.length} added, ${skipped} skipped`);
    return json({ ok: true, added: stmts.length, skipped });
  }

  // ----- Search everything (Ctrl+K) -----
  if (path === 'search' && m === 'GET') {
    const q = clean(url.searchParams.get('q'), 60);
    if (q.length < 2) return json({ contacts: [], deals: [], tasks: [] });
    const like = `%${q}%`;
    const [c, d, t] = await Promise.all([
      DB.prepare('SELECT id, name, company, email FROM crm_contacts WHERE name LIKE ? OR company LIKE ? OR email LIKE ? OR phone LIKE ? ORDER BY updated_at DESC LIMIT 6').bind(like, like, like, like).all(),
      DB.prepare('SELECT d.id, d.title, d.stage, d.value_usd, c.name contact_name FROM crm_deals d LEFT JOIN crm_contacts c ON c.id = d.contact_id WHERE d.title LIKE ? OR c.name LIKE ? OR c.company LIKE ? ORDER BY d.updated_at DESC LIMIT 6').bind(like, like, like).all(),
      DB.prepare("SELECT id, title, due, status FROM crm_tasks WHERE title LIKE ? AND status != 'done' ORDER BY due IS NULL, due LIMIT 5").bind(like).all(),
    ]);
    return json({ contacts: c.results, deals: d.results, tasks: t.results });
  }

  // ----- Reports -----
  if (path === 'reports' && m === 'GET') {
    const days = Math.min(365, Math.max(7, +url.searchParams.get('days') || 90));
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const one = async (sql, ...a) => (await DB.prepare(sql).bind(...a).first()) || {};
    const all = async (sql, ...a) => (await DB.prepare(sql).bind(...a).all()).results;
    const won = await one("SELECT COUNT(*) n, COALESCE(SUM(value_usd),0) v, AVG(julianday(closed_at) - julianday(created_at)) cycle FROM crm_deals WHERE stage = 'won' AND closed_at >= ?", since);
    const lost = await one("SELECT COUNT(*) n FROM crm_deals WHERE stage = 'lost' AND closed_at >= ?", since);
    const open = await all("SELECT stage, COUNT(*) n, COALESCE(SUM(value_usd),0) v, COALESCE(SUM(value_usd * COALESCE(probability, CASE stage WHEN 'new' THEN 10 WHEN 'contacted' THEN 20 WHEN 'call' THEN 40 WHEN 'proposal' THEN 60 WHEN 'negotiation' THEN 80 ELSE 0 END) / 100.0),0) w FROM crm_deals WHERE stage NOT IN ('won','lost') GROUP BY stage");
    const months = await all("SELECT substr(closed_at,1,7) mo, COUNT(*) n, COALESCE(SUM(value_usd),0) v FROM crm_deals WHERE stage = 'won' AND closed_at >= ? GROUP BY mo ORDER BY mo", new Date(Date.now() - 365 * 86400_000).toISOString());
    const sources = await all('SELECT COALESCE(source, \'Unknown\') source, COUNT(*) n FROM crm_contacts WHERE created_at >= ? GROUP BY source ORDER BY n DESC LIMIT 8', since);
    const owners = await all("SELECT COALESCE(u.name, 'Nobody') name, SUM(d.stage = 'won') won, COALESCE(SUM(CASE WHEN d.stage = 'won' THEN d.value_usd END),0) v, SUM(d.stage NOT IN ('won','lost')) open FROM crm_deals d LEFT JOIN users u ON u.id = d.owner_id WHERE d.created_at >= ? OR d.stage NOT IN ('won','lost') GROUP BY d.owner_id ORDER BY v DESC LIMIT 10", since);
    const activity = await all("SELECT COALESCE(author_name, 'Delegance') name, kind, COUNT(*) n FROM crm_notes WHERE created_at >= ? AND kind != 'system' GROUP BY author_name, kind", since);
    const lostReasons = await all("SELECT COALESCE(lost_reason, 'No reason given') reason, COUNT(*) n FROM crm_deals WHERE stage = 'lost' AND closed_at >= ? GROUP BY reason ORDER BY n DESC LIMIT 6", since);
    const newLeads = await one('SELECT COUNT(*) n FROM crm_contacts WHERE created_at >= ?', since);
    return json({ days, won: { n: won.n || 0, v: won.v || 0, cycle: won.cycle ? Math.round(won.cycle) : null }, lost: lost.n || 0,
      win_rate: (won.n || 0) + (lost.n || 0) ? Math.round((won.n / (won.n + lost.n)) * 100) : null, avg_deal: won.n ? Math.round(won.v / won.n) : null,
      open, months, sources, owners, activity, lost_reasons: lostReasons, new_leads: newLeads.n || 0 });
  }
  return null;
}

// Notifications are for everyone with an account.
export async function notificationRoutes(path, m, req, env, me) {
  if (path !== 'notifications' && path !== 'notifications/read') return null;
  if (m === 'GET') {
    const { results } = await env.DB.prepare('SELECT id, title, body, link, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40').bind(me.id).all();
    return json({ items: results, unread: results.filter(x => !x.read_at).length });
  }
  if (m === 'POST') { await env.DB.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').bind(now(), me.id).run(); return json({ ok: true }); }
  return null;
}

function dealOut(d) {
  const prob = d.probability != null ? d.probability : STAGE_PROB[d.stage] ?? 0;
  const last = [d.updated_at, d.last_note, d.stage_changed_at].filter(Boolean).sort().pop();
  const idle = Math.floor((Date.now() - Date.parse(last || d.created_at)) / 86400_000);
  return { ...d, probability: prob, weighted: d.value_usd ? Math.round(d.value_usd * prob / 100) : 0, idle_days: idle,
    rotting: !['won', 'lost'].includes(d.stage) && idle >= 14, overdue: !['won', 'lost'].includes(d.stage) && d.close_date && d.close_date < now().slice(0, 10) };
}
