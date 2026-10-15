// Delegance integrations: API keys, lead-capture links, the Claude MCP server and public booking.
import { now, uid, token, sha256, json, bad, clean, cleanEmail, parse, body, can, audit, limited, humanOk, emailHtml } from './_lib.js';
import { notify, adminIds, logActivity, newDeal } from './_crm.js';
import { emit } from './_auto.js';

const keyOut = k => ({ id: k.id, name: k.name, prefix: k.prefix, scope: k.scope, created_at: k.created_at, last_used: k.last_used, revoked: !!k.revoked_at, owner: k.owner || null });

// ---------- API key auth (Zapier, Make, n8n, GoHighLevel, Claude) ----------
export async function keyUser(env, raw) {
  if (!/^dlg_[A-Za-z0-9_-]{30,}$/.test(raw || '')) return null;
  const k = await env.DB.prepare("SELECT k.id kid, k.scope, k.last_used, u.* FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.hash = ? AND k.revoked_at IS NULL AND u.status = 'active'").bind(await sha256(raw)).first();
  if (!k || !can(k, 'staff')) return null;
  if (!k.last_used || Date.now() - Date.parse(k.last_used) > 300_000) await env.DB.prepare('UPDATE api_keys SET last_used = ? WHERE id = ?').bind(now(), k.kid).run();
  return { ...k, via: 'key', readonly: k.scope === 'read' };
}

export async function integrationRoutes(path, m, req, env, me) {
  const DB = env.DB, p = path.split('/');
  if (p[0] === 'apikeys') {
    if (me.via === 'key') return bad('Manage keys from the dashboard.', 403);
    if (!can(me, 'staff')) return bad('Not allowed.', 403);
    const all = can(me, 'admin');
    if (!p[1] && m === 'GET') {
      const { results } = await DB.prepare(`SELECT k.*, u.name owner FROM api_keys k LEFT JOIN users u ON u.id = k.user_id ${all ? '' : 'WHERE k.user_id = ?'} ORDER BY k.created_at DESC`).bind(...(all ? [] : [me.id])).all();
      return json({ items: results.map(k => ({ ...keyOut(k), mine: k.user_id === me.id })) });
    }
    if (!p[1] && m === 'POST') {
      const b = await body(req), name = clean(b.name, 60) || 'API key';
      const raw = 'dlg_' + token(), id = uid('ak_');
      await DB.prepare('INSERT INTO api_keys (id, user_id, name, prefix, hash, scope, created_at) VALUES (?,?,?,?,?,?,?)').bind(id, me.id, name, raw.slice(0, 10), await sha256(raw), b.scope === 'read' ? 'read' : 'write', now()).run();
      await audit(env, me.email, 'apikey.create', `${name} (${b.scope === 'read' ? 'read' : 'write'})`);
      return json({ ok: true, key: raw, mcp_url: 'https://delegance.app/api/mcp/' + raw }, 201);
    }
    if (p[1] && m === 'DELETE') {
      const r = await DB.prepare(`UPDATE api_keys SET revoked_at = ? WHERE id = ? ${all ? '' : 'AND user_id = ?'}`).bind(now(), p[1], ...(all ? [] : [me.id])).run();
      await audit(env, me.email, 'apikey.revoke', p[1]);
      return json({ ok: !!(r.meta && r.meta.changes) });
    }
  }
  if (p[0] === 'leadhooks') {
    if (!can(me, 'admin') || me.via === 'key') return bad('Only admins can manage lead-capture links.', 403);
    if (!p[1] && m === 'GET') { const { results } = await DB.prepare('SELECT id, name, prefix, source, make_deal, created_at, last_used, count, revoked_at FROM lead_hooks ORDER BY created_at DESC').all(); return json({ items: results }); }
    if (!p[1] && m === 'POST') {
      const b = await body(req), name = clean(b.name, 60) || 'Lead form';
      const raw = 'lh_' + token();
      await DB.prepare('INSERT INTO lead_hooks (id, name, hash, prefix, source, make_deal, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)').bind(uid('lh_'), name, await sha256(raw), raw.slice(0, 9), clean(b.source, 60) || name, b.make_deal === false ? 0 : 1, me.id, now()).run();
      await audit(env, me.email, 'leadhook.create', name);
      return json({ ok: true, url: 'https://delegance.app/api/hooks/' + raw }, 201);
    }
    if (p[1] && m === 'DELETE') { await DB.prepare('UPDATE lead_hooks SET revoked_at = ? WHERE id = ?').bind(now(), p[1]).run(); return json({ ok: true }); }
  }
  if (path === 'booking/settings') {
    if (!can(me, 'admin') || me.via === 'key') return bad('Only admins can change booking settings.', 403);
    if (m === 'GET') return json({ settings: await bookingCfg(env) });
    if (m === 'POST') {
      const b = await body(req), hours = {};
      for (let d = 0; d < 7; d++) { const h = (b.hours || {})[d]; if (Array.isArray(h) && h.length === 2 && +h[0] < +h[1]) hours[d] = [Math.max(0, Math.min(23.5, +h[0])), Math.max(0.5, Math.min(24, +h[1]))]; }
      const cfg = { enabled: !!b.enabled, title: clean(b.title, 80) || 'Discovery call', minutes: [15, 20, 30, 45, 60].includes(+b.minutes) ? +b.minutes : 30, tz: clean(b.tz, 60) || 'Asia/Manila', hours,
        notice_hours: Math.max(0, Math.min(168, +b.notice_hours || 12)), days_ahead: Math.max(1, Math.min(60, +b.days_ahead || 21)), buffer: Math.max(0, Math.min(60, +b.buffer || 0)), link: /^https:\/\//.test(b.link || '') ? clean(b.link, 300) : '', intro: clean(b.intro, 400) };
      try { new Intl.DateTimeFormat('en-US', { timeZone: cfg.tz }); } catch { return bad('Unknown time zone.'); }
      await DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('booking', JSON.stringify(cfg)).run();
      await audit(env, me.email, 'booking.settings');
      return json({ ok: true });
    }
  }
  if (path === 'bookings' && m === 'GET') {
    if (!can(me, 'staff')) return bad('Not allowed.', 403);
    const { results } = await DB.prepare("SELECT b.*, u.name host_name FROM bookings b LEFT JOIN users u ON u.id = b.host_id WHERE b.start_at >= ? ORDER BY b.start_at LIMIT 200").bind(new Date(Date.now() - 7 * 86400_000).toISOString()).all();
    return json({ items: results.map(({ cancel_hash, ...x }) => x), settings: await bookingCfg(env) });
  }
  return null;
}

// ---------- Lead capture: POST /api/hooks/<token> from any form, Zapier, Make, n8n, GoHighLevel ----------
export async function leadHook(req, env, raw, ctx) {
  const DB = env.DB;
  if (req.method !== 'POST') return bad('Send leads with POST.', 405);
  const h = await DB.prepare('SELECT * FROM lead_hooks WHERE hash = ? AND revoked_at IS NULL').bind(await sha256(raw)).first();
  if (!h) return bad('This lead-capture link is not valid.', 404);
  if (await limited(env, 'hook:' + h.id, 120, 60)) return bad('Too many leads at once. Slow down.', 429);
  let b = {};
  const ct = req.headers.get('Content-Type') || '';
  try { b = /json/i.test(ct) ? await req.json() : Object.fromEntries(await req.formData()); } catch { return bad('Send JSON or form data.'); }
  if (b && typeof b === 'object' && b.data && typeof b.data === 'object' && !b.email) b = { ...b, ...b.data };
  const g = (...ks) => { for (const k of ks) { const v = b[k] ?? b[k.toLowerCase()] ?? b[k.replace(/_/g, '')]; if (v != null && String(v).trim()) return String(v); } return ''; };
  const email = cleanEmail(g('email', 'email_address', 'Email'));
  const name = clean(g('name', 'full_name', 'fullName', 'contact_name') || [g('first_name', 'firstName'), g('last_name', 'lastName')].filter(Boolean).join(' ') || (email ? email.split('@')[0] : ''), 120);
  if (!name && !email) return bad('A lead needs at least a name or an email.');
  const t = now(), message = clean(g('message', 'notes', 'comments', 'details'), 3000);
  let c = email ? await DB.prepare('SELECT * FROM crm_contacts WHERE LOWER(email) = ? LIMIT 1').bind(email).first() : null, isNew = false;
  const tags = String(g('tags', 'tag') || '').split(/[,;|]/).map(x => clean(x, 30)).filter(Boolean);
  if (!c) {
    isNew = true;
    c = { id: uid('ct_') };
    await DB.prepare('INSERT INTO crm_contacts (id, name, company, email, phone, country, source, stage, kind, tags, created_at, updated_at, last_activity) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(c.id, name || email, clean(g('company', 'company_name', 'business'), 120) || null, email || null, clean(g('phone', 'phone_number', 'mobile'), 40) || null, clean(g('country'), 60) || null, clean(g('source', 'utm_source'), 60) || h.source || 'Lead form', 'new', 'lead', JSON.stringify(tags.slice(0, 12)), t, t, t).run();
  } else if (tags.length) {
    await DB.prepare('UPDATE crm_contacts SET tags = ? WHERE id = ?').bind(JSON.stringify([...new Set([...parse(c.tags, []), ...tags])].slice(0, 12)), c.id).run();
  }
  await logActivity(env, { contact_id: c.id, me: { id: null, name: 'Lead form · ' + h.name }, body: `New lead from "${h.name}".${message ? '\n\n' + message : ''}` });
  let dealId = null;
  if (h.make_deal) {
    const open = await DB.prepare("SELECT id FROM crm_deals WHERE contact_id = ? AND stage NOT IN ('won','lost')").bind(c.id).first();
    dealId = open ? open.id : await newDeal(env, { title: clean(g('deal_title', 'deal', 'service'), 140) || (clean(g('company'), 80) || name || email) + ' · ' + h.name, contact_id: c.id, source: h.source || h.name, value_usd: +g('value', 'deal_value', 'budget') > 0 ? Math.round(+g('value', 'deal_value', 'budget')) : null });
  }
  await DB.prepare('UPDATE lead_hooks SET last_used = ?, count = count + 1 WHERE id = ?').bind(t, h.id).run();
  const later = p => ctx && ctx.waitUntil ? ctx.waitUntil(p) : p;
  later(notify(env, await adminIds(env), { title: `New lead from ${h.name}`, body: name || email, link: '#contact/' + c.id }));
  if (isNew) later(emit(env, 'contact.created', { contact_id: c.id }));
  later(emit(env, 'lead.received', { contact_id: c.id, deal_id: dealId }));
  return json({ ok: true, contact_id: c.id, deal_id: dealId, created: isNew }, 201);
}

// ---------- Claude MCP server (Streamable HTTP, JSON responses) ----------
const T = (name, description, properties = {}, required = [], write = false) => ({ name, description, inputSchema: { type: 'object', properties, required }, write });
const S = { type: 'string' }, N = { type: 'number' }, B = { type: 'boolean' };
const STAGE = { type: 'string', enum: ['new', 'contacted', 'call', 'proposal', 'negotiation', 'won', 'lost'] };
export const MCP_TOOLS = [
  T('search_crm', 'Search Delegance contacts, deals and open tasks by name, company, email or phone.', { query: S }, ['query']),
  T('list_contacts', 'List contacts, newest activity first. Optional filters.', { kind: { type: 'string', enum: ['lead', 'client', 'partner'] }, tag: S, limit: N }),
  T('get_contact', 'Get one contact with its deals, tasks, requests and activity timeline.', { id: S }, ['id']),
  T('create_contact', 'Create a contact (lead, client or partner).', { name: S, email: S, company: S, phone: S, country: S, source: S, linkedin: S, kind: { type: 'string', enum: ['lead', 'client', 'partner'] } }, ['name'], true),
  T('update_contact', 'Update a contact. Only the fields you pass change. tags replaces the whole tag list.', { id: S, name: S, email: S, company: S, phone: S, country: S, source: S, linkedin: S, kind: S, tags: { type: 'array', items: S } }, ['id'], true),
  T('list_deals', 'List deals in the pipeline with value, stage, win chance and whether they have gone quiet.', { stage: STAGE, mine: B }),
  T('get_deal', 'Get one deal with its contact, tasks and activity.', { id: S }, ['id']),
  T('create_deal', 'Create a deal. Pass contact_id, or contact_name (+ company/email) to create the contact too.', { title: S, contact_id: S, contact_name: S, company: S, email: S, value_usd: N, stage: STAGE, close_date: { type: 'string', description: 'YYYY-MM-DD' } }, ['title'], true),
  T('update_deal', 'Update a deal: move stage, change value, close date or lost reason.', { id: S, stage: STAGE, value_usd: N, close_date: S, lost_reason: S, probability: N, title: S }, ['id'], true),
  T('log_activity', 'Log a note, call or meeting on a contact or deal. Use @Name to notify a teammate.', { contact_id: S, deal_id: S, kind: { type: 'string', enum: ['note', 'call', 'meeting'] }, body: S }, ['body'], true),
  T('create_task', 'Create a task, optionally linked to a contact or deal.', { title: S, due: { type: 'string', description: 'YYYY-MM-DD' }, contact_id: S, deal_id: S, priority: B }, ['title'], true),
  T('list_tasks', 'List tasks. mine=true for only your tasks.', { mine: B }),
  T('complete_task', 'Mark a task done.', { id: S }, ['id'], true),
  T('send_email', 'Send an email to a contact from Delegance and log it. Supports {{first_name}}, {{company}} and {{my_name}}.', { contact_id: S, subject: S, body: S, deal_id: S }, ['contact_id', 'subject', 'body'], true),
  T('list_requests', 'List service requests from the website, members and clients.'),
  T('pipeline_report', 'Sales report: won revenue, win rate, average deal, open pipeline and weighted forecast, sources and leaderboard.', { days: N }),
  T('list_bookings', 'Upcoming booked calls.'),
];
export async function mcp(req, env, me, ctx, call) {
  if (req.method === 'GET') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  if (req.method === 'DELETE') return new Response(null, { status: 204 });
  let msg; try { msg = await req.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
  const one = async x => {
    if (!x || x.jsonrpc !== '2.0' || typeof x.method !== 'string') return { jsonrpc: '2.0', id: x && x.id || null, error: { code: -32600, message: 'Invalid request' } };
    const id = x.id, ok = result => ({ jsonrpc: '2.0', id, result });
    if (x.method.startsWith('notifications/')) return null;
    if (x.method === 'initialize') return ok({ protocolVersion: (x.params && x.params.protocolVersion) || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'delegance-crm', title: 'Delegance CRM', version: '1.0.0' }, instructions: `You are connected to the Delegance CRM as ${me.name} (${me.role}${me.readonly ? ', read-only' : ''}). Money is in USD. Deal stages: new, contacted, call (discovery call), proposal, negotiation, won, lost. Search before creating to avoid duplicates.` });
    if (x.method === 'ping') return ok({});
    if (x.method === 'tools/list') return ok({ tools: MCP_TOOLS.filter(t => !(me.readonly && t.write)).map(({ write, ...t }) => ({ ...t, annotations: { readOnlyHint: !write } })) });
    if (x.method === 'tools/call') {
      const name = x.params && x.params.name, a = (x.params && x.params.arguments) || {}, tool = MCP_TOOLS.find(t => t.name === name);
      if (!tool) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool: ' + name } };
      if (tool.write && me.readonly) return ok({ content: [{ type: 'text', text: 'This key is read-only. Create a read and write key in Delegance → Integrations.' }], isError: true });
      if (await limited(env, 'mcp:' + me.id, 300, 3600)) return ok({ content: [{ type: 'text', text: 'Rate limit reached. Try again in a few minutes.' }], isError: true });
      try {
        const r = await runTool(name, a, call, me);
        return ok({ content: [{ type: 'text', text: JSON.stringify(r, null, 1).slice(0, 60000) }], structuredContent: r && typeof r === 'object' && !Array.isArray(r) ? r : { result: r } });
      } catch (e) { return ok({ content: [{ type: 'text', text: 'Error: ' + (e && e.message || 'failed') }], isError: true }); }
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + x.method } };
  };
  if (Array.isArray(msg)) { const out = (await Promise.all(msg.map(one))).filter(Boolean); return out.length ? json(out) : new Response(null, { status: 202 }); }
  const r = await one(msg);
  return r ? json(r) : new Response(null, { status: 202 });
}
const qs = o => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') u.set(k, v); const s = u.toString(); return s ? '?' + s : ''; };
async function runTool(name, a, call) {
  const id = encodeURIComponent(String(a.id || ''));
  switch (name) {
    case 'search_crm': return call('GET', 'search' + qs({ q: a.query }));
    case 'list_contacts': { const r = await call('GET', 'contacts' + qs({ kind: a.kind, tag: a.tag })); return { contacts: r.items.slice(0, Math.min(200, +a.limit || 50)).map(c => ({ id: c.id, name: c.name, company: c.company, email: c.email, phone: c.phone, kind: c.kind, source: c.source, tags: c.tags, owner: c.owner_name, open_deals: c.open_deals, open_value: c.open_value, last_activity: c.last_activity })), total: r.items.length }; }
    case 'get_contact': { const r = await call('GET', 'contacts/' + id); return { contact: r.contact, deals: r.deals, tasks: r.tasks, requests: r.requests, activity: r.notes.slice(0, 40).map(n => ({ kind: n.kind, by: n.author_name, at: n.created_at, text: n.body })) }; }
    case 'create_contact': return call('POST', 'contacts', a);
    case 'update_contact': { const { id: _, ...rest } = a; return call('PATCH', 'contacts/' + id, rest); }
    case 'list_deals': { const r = await call('GET', 'deals' + qs({ mine: a.mine ? 1 : '' })); return { deals: r.items.filter(d => !a.stage || d.stage === a.stage).map(d => ({ id: d.id, title: d.title, contact: d.contact_name, company: d.company, stage: d.stage, value_usd: d.value_usd, probability: d.probability, weighted: d.weighted, close_date: d.close_date, owner: d.owner_name, idle_days: d.idle_days, going_quiet: d.rotting })) }; }
    case 'get_deal': { const r = await call('GET', 'deals/' + id); return { deal: r.deal, contact: r.contact, tasks: r.tasks, activity: r.notes.slice(0, 40).map(n => ({ kind: n.kind, by: n.author_name, at: n.created_at, text: n.body })) }; }
    case 'create_deal': return call('POST', 'deals', a);
    case 'update_deal': { const { id: _, ...rest } = a; return call('PATCH', 'deals/' + id, rest); }
    case 'log_activity': return call('POST', 'activities', a);
    case 'create_task': return call('POST', 'tasks', a);
    case 'list_tasks': { const r = await call('GET', 'tasks' + qs({ mine: a.mine ? 1 : '' })); return { tasks: r.items.slice(0, 200).map(t => ({ id: t.id, title: t.title, due: t.due, status: t.status, priority: !!t.priority, assignee: t.assignee_name, contact: t.contact_name, deal: t.deal_title })) }; }
    case 'complete_task': return call('PATCH', 'tasks/' + id, { status: 'done' });
    case 'send_email': return call('POST', 'contacts/' + encodeURIComponent(a.contact_id) + '/email', a);
    case 'list_requests': return call('GET', 'requests');
    case 'pipeline_report': return call('GET', 'reports' + qs({ days: a.days }));
    case 'list_bookings': return call('GET', 'bookings');
  }
  throw new Error('Unknown tool');
}

// ---------- Public booking ----------
const DEFAULT_BOOKING = { enabled: true, title: 'Discovery call', minutes: 30, tz: 'Asia/Manila', hours: { 1: [9, 17], 2: [9, 17], 3: [9, 17], 4: [9, 17], 5: [9, 17] }, notice_hours: 12, days_ahead: 21, buffer: 0, link: '', intro: 'A 30-minute call with the Delegance team about what you want to hand over.' };
export async function bookingCfg(env) { const r = await env.DB.prepare("SELECT value FROM settings WHERE key = 'booking'").first(); return { ...DEFAULT_BOOKING, ...(r ? parse(r.value, {}) : {}) }; }
function tzOffset(date, tz) { // minutes the zone is ahead of UTC at that instant
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date).map(x => [x.type, x.value]));
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - date.getTime()) / 60000);
}
async function freeSlots(env, cfg) {
  const out = [], start = Date.now() + cfg.notice_hours * 3600_000, end = Date.now() + cfg.days_ahead * 86400_000, step = cfg.minutes + cfg.buffer;
  const { results: taken } = await env.DB.prepare("SELECT start_at, end_at FROM bookings WHERE status = 'booked' AND end_at > ?").bind(new Date().toISOString()).all();
  const busy = taken.map(b => [Date.parse(b.start_at), Date.parse(b.end_at) + cfg.buffer * 60000]);
  for (let dayT = Date.now() - 86400_000; dayT < end + 86400_000; dayT += 86400_000) {
    const off = tzOffset(new Date(dayT), cfg.tz), local = new Date(dayT + off * 60000), dow = local.getUTCDay(), hrs = cfg.hours[dow] || cfg.hours[String(dow)];
    if (!hrs) continue;
    const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - off * 60000;
    for (let m = hrs[0] * 60; m + cfg.minutes <= hrs[1] * 60; m += step) {
      const s = midnight + m * 60000, e = s + cfg.minutes * 60000;
      if (s < start || s > end) continue;
      if (busy.some(([bs, be]) => s < be && e > bs)) continue;
      out.push(new Date(s).toISOString());
    }
  }
  return [...new Set(out)].sort().slice(0, 400);
}
function ics(b, cfg) {
  const f = d => d.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Delegance//Booking//EN', 'METHOD:REQUEST', 'BEGIN:VEVENT', `UID:${b.id}@delegance.app`, `DTSTAMP:${f(new Date().toISOString())}`, `DTSTART:${f(b.start_at)}`, `DTEND:${f(b.end_at)}`,
    `SUMMARY:${cfg.title} with Delegance`, `DESCRIPTION:${(cfg.link ? 'Join: ' + cfg.link + '\\n' : '') + 'Need to change it? Reply to the confirmation email.'}`, cfg.link ? `LOCATION:${cfg.link}` : 'LOCATION:Online', 'ORGANIZER;CN=Delegance:mailto:admin@delegance.app', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
export async function bookingPublic(path, m, req, env, ip, ctx) {
  const DB = env.DB, cfg = await bookingCfg(env), later = p => ctx && ctx.waitUntil ? ctx.waitUntil(p) : p;
  if (path === 'book' && m === 'GET') return json({ enabled: cfg.enabled, title: cfg.title, minutes: cfg.minutes, intro: cfg.intro, tz: cfg.tz, slots: cfg.enabled ? await freeSlots(env, cfg) : [] });
  if (path === 'book' && m === 'POST') {
    if (!cfg.enabled) return bad('Booking is closed right now. Email admin@delegance.app.', 403);
    const b = await body(req);
    if (b.website) return json({ ok: true });
    if (await limited(env, 'book:' + ip, 5, 3600)) return bad('Too many bookings from this connection.', 429);
    const name = clean(b.name, 80), email = cleanEmail(b.email);
    if (!name || !email) return bad('Add your name and email.');
    if (!(await humanOk(env, b.turnstile, ip))) return bad('Please complete the "I am human" check.', 400);
    const slots = await freeSlots(env, cfg);
    if (!slots.includes(b.start)) return bad('That time was just taken. Please pick another.', 409);
    const t = now(), start = b.start, endAt = new Date(Date.parse(start) + cfg.minutes * 60000).toISOString();
    let c = await DB.prepare('SELECT * FROM crm_contacts WHERE LOWER(email) = ? LIMIT 1').bind(email).first(), isNew = false;
    if (!c) { isNew = true; c = { id: uid('ct_'), owner_id: null }; await DB.prepare('INSERT INTO crm_contacts (id, name, company, email, source, stage, kind, tags, created_at, updated_at, last_activity) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(c.id, name, clean(b.company, 120) || null, email, 'Booked call', 'call', 'lead', '["booked-call"]', t, t, t).run(); }
    const hostRow = await DB.prepare(`SELECT u.id, u.name, u.email FROM users u WHERE u.role IN ('staff','admin','super_admin') AND u.status = 'active' ORDER BY (SELECT COUNT(*) FROM bookings x WHERE x.host_id = u.id AND x.start_at > ?), u.created_at LIMIT 1`).bind(new Date(Date.now() - 30 * 86400_000).toISOString()).first();
    const host = c.owner_id || (hostRow && hostRow.id) || null;
    const open = await DB.prepare("SELECT id FROM crm_deals WHERE contact_id = ? AND stage NOT IN ('won','lost')").bind(c.id).first();
    const dealId = open ? open.id : await newDeal(env, { title: (clean(b.company, 80) || name) + ' · ' + cfg.title, contact_id: c.id, owner_id: host, stage: 'call', source: 'Booked call' });
    const cancelRaw = token(), id = uid('bk_');
    const bk = { id, start_at: start, end_at: endAt };
    await DB.prepare('INSERT INTO bookings (id, contact_id, host_id, deal_id, start_at, end_at, name, email, company, notes, tz, status, cancel_hash, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, c.id, host, dealId, start, endAt, name, email, clean(b.company, 120) || null, clean(b.notes, 1000) || null, clean(b.tz, 60) || null, 'booked', await sha256(cancelRaw), t).run();
    await DB.prepare('INSERT INTO crm_tasks (id, title, contact_id, deal_id, assignee_id, due, status, priority, client_visible, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(uid('tk_'), `${cfg.title} with ${name}`, c.id, dealId, host, start.slice(0, 10), 'open', 1, 0, null, t, t).run();
    await logActivity(env, { contact_id: c.id, deal_id: dealId, me: { id: null, name: 'Booking page' }, kind: 'meeting', body: `Booked a ${cfg.minutes}-minute ${cfg.title} for ${start}.${b.notes ? '\n\n' + clean(b.notes, 1000) : ''}` });
    const when = new Date(start).toLocaleString('en-US', { timeZone: clean(b.tz, 60) || cfg.tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    const cancel = 'https://delegance.app/book#cancel=' + cancelRaw;
    later(sendEmailIcs(env, { to: email, subject: `Booked: ${cfg.title} on ${when}`, intro: `Hi ${name.split(' ')[0]},\n\nYou are booked for a ${cfg.minutes}-minute ${cfg.title} with Delegance on ${when}.${cfg.link ? '\n\nJoin here: ' + cfg.link : '\n\nWe will email you the meeting link before the call.'}\n\nThe calendar invite is attached.`, button: cfg.link ? 'Join link' : null, link: cfg.link || null, outro: 'Need to cancel? Use this link: ' + cancel }, ics(bk, cfg)));
    later(notify(env, host ? [host] : await adminIds(env), { title: `New call booked: ${name}`, body: when, link: '#calendar' }));
    if (isNew) later(emit(env, 'contact.created', { contact_id: c.id }));
    later(emit(env, 'booking.created', { contact_id: c.id, deal_id: dealId, booking: { id, start_at: start, end_at: endAt, name, email, company: clean(b.company, 120) || null, notes: clean(b.notes, 1000) || null } }));
    await audit(env, email, 'booking.create', start);
    return json({ ok: true, when, start, end: endAt, link: cfg.link || null }, 201);
  }
  if (path === 'book/cancel' && m === 'POST') {
    const b = await body(req);
    if (await limited(env, 'bookc:' + ip, 20, 3600)) return bad('Too many tries.', 429);
    const bk = await DB.prepare("SELECT * FROM bookings WHERE cancel_hash = ? AND status = 'booked'").bind(await sha256(String(b.token || ''))).first();
    if (!bk) return bad('This booking was already cancelled or the link is not valid.', 404);
    await DB.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").bind(bk.id).run();
    await logActivity(env, { contact_id: bk.contact_id, deal_id: bk.deal_id, me: { id: null, name: 'Booking page' }, body: `Cancelled the call on ${bk.start_at}.` });
    later(notify(env, bk.host_id ? [bk.host_id] : await adminIds(env), { title: `Call cancelled: ${bk.name}`, body: bk.start_at, link: '#calendar' }));
    return json({ ok: true });
  }
  return null;
}
async function sendEmailIcs(env, msg, icsText) {
  if (!env.RESEND_API_KEY) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM || 'Delegance <noreply@delegance.app>', to: [msg.to], reply_to: env.TEAM_INBOX || 'admin@delegance.app', subject: msg.subject, html: emailHtml({ title: msg.subject, intro: msg.intro, button: msg.button, link: msg.link, outro: msg.outro }), text: [msg.intro, msg.outro].join('\n\n'),
        attachments: [{ filename: 'delegance-call.ics', content: btoa(unescape(encodeURIComponent(icsText))), content_type: 'text/calendar' }] }) });
    return r.ok;
  } catch { return false; }
}
