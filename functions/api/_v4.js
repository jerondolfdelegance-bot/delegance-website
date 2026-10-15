// Delegance v4: socials in the dashboard (via Desk), comment auto-replies, LinkedIn outreach queue,
// and contracts that unlock contact details between a client and a VA once both sides sign.
import { now, uid, json, bad, clean, cleanEmail, parse, body, can, audit, limited, sendEmail, seal, unseal, sha256, token, SEEN, teamInbox } from './_lib.js';
import { notify, adminIds, logActivity } from './_crm.js';

const DESK = 'https://desk.delegance.app';
const media = id => `${DESK}/public/media/${id}.jpg`;

// Server-to-server call into Desk, which holds the social tokens and the VA private details.
export async function desk(env, path, payload, me) {
  if (!env.BRIDGE_KEY) throw new Error('The link to Delegance Desk is not set up yet.');
  const r = await fetch(`${env.DESK_URL || DESK}/public/bridge/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.BRIDGE_KEY, 'X-Bridge-Email': me ? me.email : 'delegance', 'X-Bridge-Role': me && can(me, 'admin') ? 'admin' : 'member' },
    body: JSON.stringify(payload || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Desk did not answer (${r.status}).`);
  return j;
}

// Your other sign-in emails (e.g. the Gmail you used in Desk) count as you. Stored in settings, never in code.
async function myEmails(env, me) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'email_aliases'").first().catch(() => null);
  const map = (row && parse(row.value, null)) || {};
  return [me.email, ...((map[me.email] || []).map(String))];
}

async function visibleAccounts(env, me) {
  const mine = await myEmails(env, me), qs = mine.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`SELECT a.id, a.network, a.name, a.handle, a.avatar, a.client, a.status, a.status_note, a.private, a.enabled, c.connected_by
    FROM accounts a LEFT JOIN connections c ON c.id = a.connection_id WHERE (a.private = 0 OR c.connected_by IN (${qs})) ORDER BY a.enabled DESC, a.network, a.name`).bind(...mine).all();
  return results.map(a => ({ ...a, mine: mine.includes(a.connected_by) }));
}

// ---------------- Social (team) ----------------
export async function socialRoutes(path, m, req, env, me, url) {
  const DB = env.DB, p = path.split('/');
  if (p[0] !== 'social' || !can(me, 'staff')) return null;
  const accts = await visibleAccounts(env, me), ids = new Set(accts.map(a => a.id)), live = new Set(accts.filter(a => a.enabled).map(a => a.id));
  const onlyVisible = list => list.length > 0 && list.every(id => ids.has(id));

  if (!p[1] && m === 'GET') {
    const since = new Date(Date.now() - 21 * 86400_000).toISOString();
    const { results: posts } = await DB.prepare(`SELECT id, body, status, scheduled_at, published_at, created_by, review_note, media_id, link_url FROM posts
      WHERE status IN ('scheduled','review','publishing','failed','partial','draft') OR (status = 'published' AND published_at > ?) ORDER BY COALESCE(scheduled_at, published_at, updated_at) DESC LIMIT 80`).bind(since).all();
    const pids = posts.map(x => x.id);
    const targets = pids.length ? (await DB.prepare(`SELECT post_id, account_id, status, permalink, error FROM post_targets WHERE post_id IN (${pids.map(() => '?').join(',')})`).bind(...pids).all()).results : [];
    const items = posts.map(x => ({ ...x, media: x.media_id ? media(x.media_id) : null, targets: targets.filter(t => t.post_id === x.id) }))
      .filter(x => x.targets.length ? x.targets.every(t => ids.has(t.account_id)) : x.created_by === me.email);
    const idList = [...ids];
    const comments = idList.length ? (await DB.prepare(`SELECT id, channel, contact_name, subject, last_preview, last_message_at, unread, permalink, account_id, status FROM conversations
      WHERE channel IN ('facebook','instagram','youtube') AND account_id IN (${idList.map(() => '?').join(',')}) ORDER BY last_message_at DESC LIMIT 40`).bind(...idList).all()).results : [];
    const { results: rules } = await DB.prepare('SELECT * FROM autoreplies ORDER BY created_at DESC').all();
    const { results: lib } = await DB.prepare("SELECT id, mime, name FROM media WHERE created_by != 'candidate' AND mime LIKE 'image/%' ORDER BY created_at DESC LIMIT 24").all();
    const st = Object.fromEntries((await DB.prepare("SELECT key, value FROM settings WHERE key IN ('last_tick','last_comment_sync')").all()).results.map(r => [r.key, r.value]));
    return json({
      accounts: accts, posts: items, comments,
      rules: rules.map(r => ({ ...r, account_ids: parse(r.account_ids, []), keywords: parse(r.keywords, []), replies: parse(r.replies, []), mine: r.created_by === me.id }))
        .filter(r => r.mine || onlyVisible(r.account_ids)),
      media: lib.map(x => ({ id: x.id, url: media(x.id), name: x.name })), last_tick: st.last_tick || null, last_comment_sync: st.last_comment_sync || null,
      bridge: !!env.BRIDGE_KEY,
    });
  }
  if (p[1] === 'posts' && m === 'POST') {
    const b = await body(req), list = (Array.isArray(b.account_ids) ? b.account_ids : []).map(String).slice(0, 30);
    if (!list.every(id => live.has(id)) || (!list.length && (b.publish_now || b.scheduled_at))) return bad('Choose at least one of your connected accounts.');
    if (await limited(env, 'spost:' + me.id, 60, 3600)) return bad('That is a lot of posts this hour. Please wait a little.', 429);
    try {
      const r = await desk(env, 'posts', { body: b.body, account_ids: list, link_url: b.link_url, first_comment: b.first_comment, media_id: b.media_id, status: b.publish_now ? 'scheduled' : (b.scheduled_at ? 'scheduled' : 'draft'), scheduled_at: b.scheduled_at, publish_now: !!b.publish_now }, me);
      await audit(env, me.email, 'social.post', `${r.id} ${r.status}`);
      return json({ ok: true, ...r }, 201);
    } catch (e) { return bad(e.message); }
  }
  if (p[1] === 'comments' && p[2]) {
    const c = await DB.prepare("SELECT * FROM conversations WHERE id = ? AND channel IN ('facebook','instagram','youtube')").bind(p[2]).first();
    if (!c || !ids.has(c.account_id)) return bad('Comment not found.', 404);
    if (!p[3] && m === 'GET') {
      const { results } = await DB.prepare('SELECT direction, author, body, is_ai, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at').bind(c.id).all();
      if (c.unread) await DB.prepare('UPDATE conversations SET unread = 0 WHERE id = ?').bind(c.id).run();
      return json({ conversation: { id: c.id, channel: c.channel, contact_name: c.contact_name, subject: c.subject, permalink: c.permalink }, messages: results });
    }
    if (p[3] === 'reply' && m === 'POST') {
      const b = await body(req);
      try { await desk(env, 'reply', { conversation_id: c.id, body: b.body }, me); return json({ ok: true }, 201); } catch (e) { return bad(e.message); }
    }
  }
  if (p[1] === 'accounts' && p[2] && m === 'PATCH') {
    const a = accts.find(x => x.id === p[2]);
    if (!a) return bad('Account not found.', 404);
    const b = await body(req);
    if (b.private !== undefined) {
      if (!a.mine && !can(me, 'super_admin')) return bad('Only the person who connected this account can make it private.', 403);
      await DB.prepare('UPDATE accounts SET private = ? WHERE id = ?').bind(b.private ? 1 : 0, a.id).run();
    }
    if (b.enabled !== undefined) {
      if (!a.mine && !can(me, 'super_admin')) return bad('Only the person who connected this page can switch it on or off.', 403);
      await DB.prepare('UPDATE accounts SET enabled = ?, updated_at = ? WHERE id = ?').bind(b.enabled ? 1 : 0, new Date().toISOString(), a.id).run();
      await audit(env, me.email, 'social.toggle', `${a.network} ${a.name} ${b.enabled ? 'on' : 'off'}`);
    }
    if (b.client !== undefined) {
      if (!a.mine && !can(me, 'admin')) return bad('Only the person who connected this page (or an admin) can move it to another profile.', 403);
      await DB.prepare('UPDATE accounts SET client = ? WHERE id = ?').bind(clean(b.client, 60) || null, a.id).run();
    }
    return json({ ok: true });
  }
  if (p[1] === 'accounts' && p[2] && m === 'DELETE') {
    const a = accts.find(x => x.id === p[2]);
    if (!a) return bad('Account not found.', 404);
    if (!a.mine && !can(me, 'super_admin')) return bad('Only the person who connected this page can disconnect it.', 403);
    try { await desk(env, 'disconnect', { id: a.id }, me); } catch (e) { return bad(e.message); }
    await audit(env, me.email, 'social.disconnect', `${a.network} ${a.name}`);
    return json({ ok: true });
  }
  if (p[1] === 'autoreplies') {
    if (!p[2] && m === 'POST') {
      const f = ruleInput(await body(req)); if (typeof f === 'string') return bad(f);
      if (!onlyVisible(f.account_ids)) return bad('Pick the accounts this rule replies on.');
      const t = now();
      await DB.prepare('INSERT INTO autoreplies (id, name, active, account_ids, keywords, replies, created_by, created_at, updated_at) VALUES (?,?,1,?,?,?,?,?,?)')
        .bind(uid('ar_'), f.name, JSON.stringify(f.account_ids), JSON.stringify(f.keywords), JSON.stringify(f.replies), me.id, t, t).run();
      await audit(env, me.email, 'autoreply.create', f.name);
      return json({ ok: true }, 201);
    }
    const r = p[2] && await DB.prepare('SELECT * FROM autoreplies WHERE id = ?').bind(p[2]).first();
    if (!r || (r.created_by !== me.id && !can(me, 'super_admin'))) return bad('Only the person who made this rule can change it.', 404);
    if (m === 'PATCH') {
      const b = await body(req);
      if (Object.keys(b).length === 1 && 'active' in b) { await DB.prepare('UPDATE autoreplies SET active = ?, updated_at = ? WHERE id = ?').bind(b.active ? 1 : 0, now(), r.id).run(); return json({ ok: true }); }
      const f = ruleInput(b); if (typeof f === 'string') return bad(f);
      if (!onlyVisible(f.account_ids)) return bad('Pick the accounts this rule replies on.');
      await DB.prepare('UPDATE autoreplies SET name = ?, account_ids = ?, keywords = ?, replies = ?, updated_at = ? WHERE id = ?').bind(f.name, JSON.stringify(f.account_ids), JSON.stringify(f.keywords), JSON.stringify(f.replies), now(), r.id).run();
      return json({ ok: true });
    }
    if (m === 'DELETE') { await DB.prepare('DELETE FROM autoreplies WHERE id = ?').bind(r.id).run(); await audit(env, me.email, 'autoreply.delete', r.name); return json({ ok: true }); }
  }
  return null;
}
function ruleInput(b) {
  const name = clean(b.name, 80); if (!name) return 'Give the rule a name.';
  const account_ids = (Array.isArray(b.account_ids) ? b.account_ids : []).map(String).slice(0, 30);
  const keywords = (Array.isArray(b.keywords) ? b.keywords : String(b.keywords || '').split(',')).map(k => clean(k, 40).toLowerCase()).filter(Boolean).slice(0, 20);
  const replies = (Array.isArray(b.replies) ? b.replies : String(b.replies || '').split('\n---\n')).map(x => clean(x, 600)).filter(Boolean).slice(0, 5);
  if (!replies.length) return 'Write at least one reply.';
  return { name, account_ids, keywords, replies };
}

// ---------------- LinkedIn outreach queue (team) ----------------
// LinkedIn does not allow apps to send messages, so Delegance writes each message and you send it with one click.
export async function outreachRoutes(path, m, req, env, me) {
  const DB = env.DB, p = path.split('/');
  if (p[0] !== 'outreach' || !can(me, 'staff')) return null;
  if (!p[1] && m === 'GET') {
    const { results } = await DB.prepare(`SELECT o.*, c.name, c.company, c.linkedin FROM outreach o JOIN crm_contacts c ON c.id = o.contact_id
      WHERE o.owner_id = ? AND (o.status = 'queued' OR o.sent_at > ?) ORDER BY o.status != 'queued', o.created_at LIMIT 300`).bind(me.id, new Date(Date.now() - 30 * 86400_000).toISOString()).all();
    return json({ items: results });
  }
  if (!p[1] && m === 'POST') {
    const b = await body(req), msg = clean(b.message, 1900);
    if (msg.length < 10) return bad('Write the message first.');
    const want = (Array.isArray(b.contact_ids) ? b.contact_ids : []).map(String).slice(0, 100);
    if (!want.length) return bad('Pick at least one contact.');
    const { results: cs } = await DB.prepare(`SELECT c.id, c.name, c.company FROM crm_contacts c WHERE c.id IN (${want.map(() => '?').join(',')}) AND ${SEEN('c')}`).bind(...want, me.id).all();
    const first = n => String(n || '').trim().split(/\s+/)[0] || 'there';
    const fill = c => msg.replace(/\{\{\s*first_name\s*\}\}/g, first(c.name)).replace(/\{\{\s*name\s*\}\}/g, c.name || '').replace(/\{\{\s*company\s*\}\}/g, c.company || 'your team').replace(/\{\{\s*my_name\s*\}\}/g, first(me.name));
    const t = now();
    if (cs.length) await DB.batch(cs.map(c => DB.prepare('INSERT INTO outreach (id, contact_id, owner_id, channel, message, status, created_at) VALUES (?,?,?,?,?,?,?)').bind(uid('or_'), c.id, me.id, 'linkedin', fill(c), 'queued', t)));
    return json({ ok: true, added: cs.length }, 201);
  }
  const o = p[1] && await DB.prepare('SELECT * FROM outreach WHERE id = ? AND owner_id = ?').bind(p[1], me.id).first();
  if (!o) return bad('Not found.', 404);
  if (m === 'PATCH') {
    const b = await body(req);
    if (!['sent', 'skipped', 'replied', 'queued'].includes(b.status)) return bad('Unknown status.');
    if (typeof b.message === 'string' && o.status === 'queued') await DB.prepare('UPDATE outreach SET message = ? WHERE id = ?').bind(clean(b.message, 1900), o.id).run();
    await DB.prepare('UPDATE outreach SET status = ?, sent_at = CASE WHEN ? IN (\'sent\',\'replied\') THEN COALESCE(sent_at, ?) ELSE sent_at END WHERE id = ?').bind(b.status, b.status, now(), o.id).run();
    if (b.status === 'sent' && o.status !== 'sent') await logActivity(env, { contact_id: o.contact_id, me, kind: 'note', body: 'LinkedIn message sent:\n' + o.message });
    if (b.status === 'replied') await logActivity(env, { contact_id: o.contact_id, me, kind: 'note', body: 'Replied on LinkedIn.' });
    return json({ ok: true });
  }
  if (m === 'DELETE') { await DB.prepare('DELETE FROM outreach WHERE id = ?').bind(o.id).run(); return json({ ok: true }); }
  return null;
}

// ---------------- Contracts (admin) ----------------
const TERMS = `1. Delegance introduces the client and the virtual assistant (VA) and manages this engagement.
2. The VA does the work described above at the agreed rate and hours. Changes are agreed in writing through Delegance.
3. The client pays Delegance; Delegance pays the VA. Neither side asks for or makes payments outside Delegance.
4. Both sides keep each other's business information confidential, during and after this engagement.
5. Work the VA creates for the client belongs to the client once it is paid for.
6. Either side can end this engagement with 7 days' notice by telling Delegance.
7. Contact details are shared only so both sides can work together on this engagement.`;

export async function contractRoutes(path, m, req, env, me) {
  const DB = env.DB, p = path.split('/');
  if (p[0] !== 'contracts' || !can(me, 'admin')) return null;
  if (!p[1] && m === 'GET') {
    const { results } = await DB.prepare('SELECT id, title, client_name, client_company, va_name, status, client_signed_at, va_signed_at, created_at, rate, hours, start_date FROM contracts ORDER BY created_at DESC LIMIT 200').all();
    const { results: cands } = await DB.prepare("SELECT id, name, headline FROM candidates WHERE status = 'approved' ORDER BY name LIMIT 300").all();
    const { results: chats } = await DB.prepare("SELECT id, channel, contact_name, contact_email, subject, account_id, last_message_at FROM conversations WHERE channel IN ('va','hire') ORDER BY last_message_at DESC LIMIT 60").all();
    return json({ items: results, candidates: cands, chats, terms: TERMS });
  }
  if (!p[1] && m === 'POST') {
    const b = await body(req);
    const cand = await DB.prepare("SELECT id, name FROM candidates WHERE id = ? AND status = 'approved'").bind(String(b.candidate_id || '')).first();
    if (!cand) return bad('Pick the virtual assistant.');
    const name = clean(b.client_name, 100), email = cleanEmail(b.client_email), title = clean(b.title, 120), terms = clean(b.terms, 6000) || TERMS;
    if (!name || !email) return bad("Add the client's name and email.");
    if (!title) return bad('Name the role, for example: Executive assistant, 20 hrs/week.');
    let conv = null;
    if (b.conversation_id) {
      conv = await DB.prepare("SELECT id FROM conversations WHERE id = ? AND channel IN ('va','hire')").bind(String(b.conversation_id)).first();
      if (!conv) return bad('That chat was not found.');
    }
    let va; try { va = await desk(env, 'candidate-contact', { id: cand.id }, me); } catch (e) { return bad(e.message); }
    const ct = token(), vt = token(), id = uid('k_'), t = now();
    await DB.prepare(`INSERT INTO contracts (id, candidate_id, conversation_id, title, rate, hours, start_date, terms, client_name, client_company, client_enc, va_name, client_token, va_token, status, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'sent', ?, ?, ?)`).bind(id, cand.id, conv ? conv.id : null, title, clean(b.rate, 60) || null, clean(b.hours, 60) || null, /^\d{4}-\d{2}-\d{2}$/.test(b.start_date || '') ? b.start_date : null,
      terms, name, clean(b.client_company, 120) || null, await seal(env, JSON.stringify({ email, phone: clean(b.client_phone, 40) || null })), cand.name, await sha256(ct), await sha256(vt), me.id, t, t).run();
    const cl = `https://delegance.app/contract#${id}.${ct}`, vl = `https://delegance.app/contract#${id}.${vt}`;
    const [e1, e2] = await Promise.all([
      sendEmail(env, { to: email, subject: `Your Delegance agreement with ${cand.name}`, intro: `Hi ${name.split(' ')[0]},\n\nYour agreement for "${title}" with ${cand.name} is ready. Please read and sign it. Once you both sign, you can see each other's contact details and start working.`, button: 'Read and sign', link: cl, outro: 'Questions? Just reply to this email.' }),
      va.email ? sendEmail(env, { to: va.email, subject: `New Delegance agreement: ${title}`, intro: `Hi ${cand.name.split(' ')[0]},\n\nA client (${name}${b.client_company ? ', ' + clean(b.client_company, 120) : ''}) wants to work with you on "${title}". Please read and sign the agreement. Once you both sign, you can see each other's contact details.`, button: 'Read and sign', link: vl, outro: 'Questions? Just reply to this email.' }) : false,
    ]);
    await audit(env, me.email, 'contract.create', `${id} ${cand.name} / ${name}`);
    return json({ ok: true, id, client_link: cl, va_link: vl, emailed_client: !!e1, emailed_va: !!e2 }, 201);
  }
  if (p[1] && p[2] === 'cancel' && m === 'POST') {
    const r = await DB.prepare("UPDATE contracts SET status = 'ended', updated_at = ? WHERE id = ? AND status != 'ended'").bind(now(), p[1]).run();
    await audit(env, me.email, 'contract.end', p[1]);
    return r.meta.changes ? json({ ok: true }) : bad('Contract not found.', 404);
  }
  return null;
}

// Public: each side opens their own link (#id.token). Contact details appear only when both have signed.
export async function contractPublic(path, m, req, env, ip) {
  if (path !== 'contract' && path !== 'contract/sign') return null;
  if (await limited(env, 'ctr:' + ip, 120, 3600)) return bad('Too many tries. Please wait a little.', 429);
  const b = m === 'POST' ? await body(req) : {};
  if (m !== 'POST') return bad('Not found.', 404);
  const id = String(b.id || ''), tk = String(b.t || '');
  const k = /^k_[a-f0-9]{20}$/.test(id) && tk.length >= 30 ? await env.DB.prepare('SELECT * FROM contracts WHERE id = ?').bind(id).first() : null;
  const h = k && await sha256(tk);
  const side = k ? (h === k.client_token ? 'client' : h === k.va_token ? 'va' : null) : null;
  if (!side) return bad('This agreement link is not valid. Ask admin@delegance.app for a new one.', 404);
  if (path === 'contract/sign' && m === 'POST') {
    if (k.status !== 'sent') return bad(k.status === 'active' ? 'This agreement is already signed by both sides.' : 'This agreement has ended.');
    const name = clean(b.name, 100);
    if (!b.agree || name.length < 3) return bad('Type your full name and tick the box to sign.');
    const col = side === 'client' ? 'client' : 'va', t = now();
    await env.DB.prepare(`UPDATE contracts SET ${col}_signed = ?, ${col}_signed_at = ?, updated_at = ? WHERE id = ? AND ${col}_signed_at IS NULL`).bind(`${name} · ${ip}`, t, t, k.id).run();
    const after = await env.DB.prepare('SELECT * FROM contracts WHERE id = ?').bind(k.id).first();
    if (after.client_signed_at && after.va_signed_at && after.status === 'sent') {
      await env.DB.prepare("UPDATE contracts SET status = 'active', updated_at = ? WHERE id = ?").bind(t, k.id).run();
      await notify(env, await adminIds(env), { title: `Agreement signed: ${k.title}`, body: `${k.client_name} and ${k.va_name} both signed. Contact details are now shared.`, link: '#contracts' });
      await sendEmail(env, { to: teamInbox(env), subject: `Agreement active: ${k.va_name} for ${k.client_name}`, intro: `Both sides signed "${k.title}". Contact details are now visible to both of them.` });
    } else {
      await notify(env, await adminIds(env), { title: `${side === 'client' ? k.client_name : k.va_name} signed "${k.title}"`, body: 'Waiting for the other side.', link: '#contracts' });
    }
    await audit(env, side, 'contract.sign', k.id);
    return contractView(env, after.client_signed_at && after.va_signed_at ? { ...after, status: 'active' } : after, side);
  }
  return contractView(env, k, side);
}
async function contractView(env, k, side) {
  const out = { id: k.id, side, title: k.title, rate: k.rate, hours: k.hours, start_date: k.start_date, terms: k.terms, status: k.status, client_name: k.client_name, client_company: k.client_company, va_name: k.va_name,
    client_signed_at: k.client_signed_at, va_signed_at: k.va_signed_at, created_at: k.created_at };
  if (k.status === 'active') {
    if (side === 'va') { const c = parse(await unseal(env, k.client_enc), {}); out.contact = { name: k.client_name, company: k.client_company, email: c.email, phone: c.phone }; }
    else { try { const v = await desk(env, 'candidate-contact', { id: k.candidate_id }, null); out.contact = { name: v.full_name || k.va_name, email: v.email, phone: v.phone }; } catch { out.contact = { name: k.va_name, note: 'Contact details are on their way by email.' }; } }
  }
  return json(out);
}
