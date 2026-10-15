// Delegance automations: GoHighLevel-style workflows + outbound webhooks (Zapier, Make, n8n, GoHighLevel).
import { now, uid, json, bad, clean, parse, body, can, audit, sendEmail, limited, sha256 } from './_lib.js';
import { notify, adminIds, logActivity, newDeal, DEAL_STAGES } from './_crm.js';

export const EVENTS = {
  'contact.created': 'A new contact is added (website, form, import, API)',
  'lead.received': 'A lead arrives from the website or a lead-capture link',
  'deal.created': 'A new deal is created',
  'deal.stage_changed': 'A deal moves to a stage',
  'deal.won': 'A deal is won',
  'deal.lost': 'A deal is lost',
  'deal.idle': 'A deal has had no activity for some days',
  'request.created': 'A client or member sends a request',
  'message.received': 'A client sends a message',
  'task.completed': 'A task is marked done',
  'booking.created': 'Someone books a call',
};
const ACTIONS = ['create_task', 'send_email', 'notify', 'add_tag', 'remove_tag', 'set_owner', 'move_stage', 'create_deal', 'webhook', 'wait'];
const FIELDS = ['contact.source', 'contact.kind', 'contact.country', 'contact.tags', 'contact.email', 'deal.stage', 'deal.value_usd', 'deal.source', 'request.title', 'booking.company'];

// ---------- Event bus ----------
// emit() never throws and never blocks the request: callers pass it to ctx.waitUntil.
export async function emit(env, event, data) {
  try {
    const DB = env.DB;
    const [{ results: autos }, { results: hooks }] = await Promise.all([
      DB.prepare('SELECT * FROM automations WHERE active = 1 AND trigger = ?').bind(event).all(),
      DB.prepare('SELECT * FROM webhooks WHERE active = 1').all(),
    ]);
    const ctx = await loadCtx(env, { event, ...data });
    await Promise.all([
      ...autos.filter(a => a.trigger !== 'deal.stage_changed' || !a.trigger_value || a.trigger_value === (ctx.deal && ctx.deal.stage)).map(a => runAutomation(env, a, ctx, 0)),
      ...hooks.filter(h => { const ev = parse(h.events, ['*']); return ev.includes('*') || ev.includes(event); }).map(h => deliver(env, h, event, ctx)),
    ]);
  } catch (e) { console.error('emit', event, e && e.message); }
}

async function loadCtx(env, c) {
  const DB = env.DB, out = { event: c.event, at: now() };
  if (c.deal_id) out.deal = await DB.prepare('SELECT * FROM crm_deals WHERE id = ?').bind(c.deal_id).first();
  const cid = c.contact_id || (out.deal && out.deal.contact_id);
  if (cid) { out.contact = await DB.prepare('SELECT * FROM crm_contacts WHERE id = ?').bind(cid).first(); if (out.contact) out.contact.tags = parse(out.contact.tags, []); }
  for (const k of ['task', 'request', 'booking', 'message', 'from_stage']) if (c[k] !== undefined) out[k] = c[k];
  return out;
}
const pick = (ctx, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
function passes(conds, ctx) {
  return (conds || []).every(c => {
    const v = pick(ctx, c.field), w = String(c.value == null ? '' : c.value).toLowerCase();
    const s = Array.isArray(v) ? v.map(x => String(x).toLowerCase()) : String(v == null ? '' : v).toLowerCase();
    switch (c.op) {
      case 'equals': return Array.isArray(s) ? s.includes(w) : s === w;
      case 'not_equals': return Array.isArray(s) ? !s.includes(w) : s !== w;
      case 'contains': return Array.isArray(s) ? s.some(x => x.includes(w)) : s.includes(w);
      case 'gte': return +v >= +c.value;
      case 'lte': return +v <= +c.value;
      case 'exists': return Array.isArray(s) ? s.length > 0 : s !== '';
      case 'missing': return Array.isArray(s) ? !s.length : s === '';
      default: return true;
    }
  });
}
const fill = (s, ctx) => String(s || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
  if (k === 'first_name') return ctx.contact ? ctx.contact.name.split(' ')[0] : 'there';
  const v = pick(ctx, k); return v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v);
});

async function runAutomation(env, a, ctx, from) {
  const DB = env.DB, steps = parse(a.actions, []), subject = (ctx.deal && ctx.deal.title) || (ctx.contact && ctx.contact.name) || ctx.event;
  if (from === 0 && !passes(parse(a.conditions, []), ctx)) return;
  const done = [];
  try {
    for (let i = from; i < steps.length; i++) {
      const s = steps[i];
      if (s.type === 'wait') {
        const ms = Math.max(1, Math.min(24 * 90, +s.hours || 1)) * 3600_000;
        await DB.prepare('INSERT INTO automation_queue (id, automation_id, step, ctx, run_at, created_at) VALUES (?,?,?,?,?,?)').bind(uid('aq_'), a.id, i + 1, JSON.stringify({ event: ctx.event, contact_id: ctx.contact && ctx.contact.id, deal_id: ctx.deal && ctx.deal.id }), Date.now() + ms, now()).run();
        done.push(`wait ${s.hours}h`);
        break;
      }
      done.push(await act(env, s, ctx, a));
    }
    await DB.batch([
      DB.prepare('UPDATE automations SET runs = runs + 1, last_run = ? WHERE id = ?').bind(now(), a.id),
      DB.prepare('INSERT INTO automation_log (id, automation_id, subject, status, detail, created_at) VALUES (?,?,?,?,?,?)').bind(uid('al_'), a.id, String(subject).slice(0, 140), 'ok', done.join(' → ').slice(0, 500), now()),
    ]);
  } catch (e) {
    await DB.prepare('INSERT INTO automation_log (id, automation_id, subject, status, detail, created_at) VALUES (?,?,?,?,?,?)').bind(uid('al_'), a.id, String(subject).slice(0, 140), 'error', (done.join(' → ') + ' ✕ ' + (e && e.message)).slice(0, 500), now()).run();
  }
}

async function roundRobin(env) {
  const r = await env.DB.prepare(`SELECT u.id FROM users u WHERE u.role IN ('staff','admin','super_admin') AND u.status = 'active'
    ORDER BY (SELECT COUNT(*) FROM crm_contacts c WHERE c.owner_id = u.id AND c.created_at > ?) , u.created_at LIMIT 1`).bind(new Date(Date.now() - 30 * 86400_000).toISOString()).first();
  return r && r.id;
}
async function act(env, s, ctx, a) {
  const DB = env.DB, c = ctx.contact, d = ctx.deal, bot = { id: null, name: 'Automation · ' + a.name };
  switch (s.type) {
    case 'create_task': {
      const who = s.assignee === 'owner' ? ((d && d.owner_id) || (c && c.owner_id) || await roundRobin(env)) : s.assignee === 'round_robin' ? await roundRobin(env) : s.assignee;
      const due = s.due_days !== '' && s.due_days != null ? new Date(Date.now() + (+s.due_days || 0) * 86400_000).toISOString().slice(0, 10) : null;
      const t = now(), title = fill(s.title || 'Follow up', ctx);
      await DB.prepare('INSERT INTO crm_tasks (id, title, contact_id, deal_id, assignee_id, due, status, priority, client_visible, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(uid('tk_'), title.slice(0, 200), c ? c.id : null, d ? d.id : null, who || null, due, 'open', s.priority ? 1 : 0, 0, null, t, t).run();
      if (who) await notify(env, [who], { title: 'New task from an automation', body: title, link: '#tasks' });
      return 'task';
    }
    case 'send_email': {
      if (!c || !c.email) return 'email skipped (no email)';
      const ok = await sendEmail(env, { to: c.email, subject: fill(s.subject, ctx), title: fill(s.subject, ctx), intro: fill(s.body, ctx), outro: 'Delegance · Just reply to this email to answer.' });
      if (ok) await logActivity(env, { contact_id: c.id, deal_id: d && d.id, me: bot, kind: 'email', body: `Automated email: ${fill(s.subject, ctx)}` });
      return ok ? 'email' : 'email failed';
    }
    case 'notify': {
      const ids = s.to === 'admins' ? await adminIds(env) : s.to === 'owner' ? [(d && d.owner_id) || (c && c.owner_id)].filter(Boolean) : [s.to];
      await notify(env, ids.length ? ids : await adminIds(env), { title: fill(s.title || a.name, ctx), body: subjectLine(ctx), link: d ? '#deal/' + d.id : c ? '#contact/' + c.id : '#home' });
      return 'notify';
    }
    case 'add_tag': case 'remove_tag': {
      if (!c) return 'no contact';
      const tag = clean(fill(s.tag, ctx), 30); if (!tag) return 'no tag';
      const tags = s.type === 'add_tag' ? [...new Set([...(c.tags || []), tag])].slice(0, 12) : (c.tags || []).filter(x => x !== tag);
      await DB.prepare('UPDATE crm_contacts SET tags = ? WHERE id = ?').bind(JSON.stringify(tags), c.id).run(); c.tags = tags;
      return s.type.replace('_', ' ');
    }
    case 'set_owner': {
      const who = s.owner === 'round_robin' || !s.owner ? await roundRobin(env) : s.owner;
      if (!who) return 'no owner available';
      if (c) { await DB.prepare('UPDATE crm_contacts SET owner_id = ? WHERE id = ?').bind(who, c.id).run(); c.owner_id = who; }
      if (d) { await DB.prepare('UPDATE crm_deals SET owner_id = ? WHERE id = ?').bind(who, d.id).run(); d.owner_id = who; }
      await notify(env, [who], { title: 'You were given a new lead', body: subjectLine(ctx), link: d ? '#deal/' + d.id : c ? '#contact/' + c.id : '#home' });
      return 'owner';
    }
    case 'move_stage': {
      if (!d || !DEAL_STAGES.includes(s.stage) || d.stage === s.stage) return 'stage unchanged';
      const t = now();
      await DB.prepare('UPDATE crm_deals SET stage = ?, stage_changed_at = ?, updated_at = ?, closed_at = ? WHERE id = ?').bind(s.stage, t, t, ['won', 'lost'].includes(s.stage) ? t : null, d.id).run();
      await logActivity(env, { contact_id: d.contact_id, deal_id: d.id, me: bot, body: `Moved to ${s.stage} by automation.` });
      d.stage = s.stage;
      return 'stage';
    }
    case 'create_deal': {
      if (!c) return 'no contact';
      const open = await DB.prepare("SELECT id FROM crm_deals WHERE contact_id = ? AND stage NOT IN ('won','lost')").bind(c.id).first();
      if (open) return 'deal exists';
      const id = await newDeal(env, { title: fill(s.title || '{{contact.company}} deal', ctx) || c.name + ' deal', contact_id: c.id, owner_id: c.owner_id, stage: s.stage || 'new', value_usd: s.value_usd ? Math.round(+s.value_usd) : null, source: c.source });
      ctx.deal = await DB.prepare('SELECT * FROM crm_deals WHERE id = ?').bind(id).first();
      return 'deal';
    }
    case 'webhook': {
      const r = await post(s.url, { event: ctx.event, automation: a.name, data: slim(ctx), sent_at: now() }, s.secret);
      return 'webhook ' + r;
    }
    default: return 'skipped ' + s.type;
  }
}
const subjectLine = ctx => [ctx.contact && ctx.contact.name, ctx.contact && ctx.contact.company, ctx.deal && ctx.deal.title].filter(Boolean).join(' · ');
function slim(ctx) {
  const c = ctx.contact, d = ctx.deal;
  return {
    contact: c ? { id: c.id, name: c.name, email: c.email, phone: c.phone, company: c.company, country: c.country, source: c.source, kind: c.kind, tags: c.tags } : null,
    deal: d ? { id: d.id, title: d.title, stage: d.stage, value_usd: d.value_usd, close_date: d.close_date, source: d.source } : null,
    task: ctx.task || null, request: ctx.request || null, booking: ctx.booking || null, message: ctx.message || null, from_stage: ctx.from_stage || null,
  };
}
async function hmac(secret, text) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeUrl(u) { try { const x = new URL(u); return x.protocol === 'https:' && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/.test(x.hostname) ? x.href : null; } catch { return null; } }
async function post(url, payload, secret) {
  const u = safeUrl(url); if (!u) return 'bad url';
  const text = JSON.stringify(payload), h = { 'Content-Type': 'application/json', 'User-Agent': 'Delegance-Webhooks/1.0', 'X-Delegance-Event': payload.event };
  if (secret) h['X-Delegance-Signature'] = 'sha256=' + await hmac(secret, text);
  try { const r = await fetch(u, { method: 'POST', headers: h, body: text, signal: AbortSignal.timeout(8000) }); return r.status; } catch (e) { return 'error'; }
}
async function deliver(env, h, event, ctx) {
  const st = await post(h.url, { event, data: slim(ctx), sent_at: now() }, h.secret);
  const ok = typeof st === 'number' && st < 400;
  await env.DB.prepare('UPDATE webhooks SET last_status = ?, last_at = ?, fails = CASE WHEN ? THEN 0 ELSE fails + 1 END, active = CASE WHEN ? THEN active WHEN fails >= 49 THEN 0 ELSE active END WHERE id = ?')
    .bind(typeof st === 'number' ? st : 0, now(), ok ? 1 : 0, ok ? 1 : 0, h.id).run();
}

// ---------- Scheduler: delayed steps + idle-deal triggers. Runs from /api/cron (Desk's 5-minute cron) and lazily. ----------
export async function runDue(env) {
  const DB = env.DB, t = Date.now();
  // Housekeeping: drop expired sign-in tokens, sessions and old rate-limit noise so tables stay small.
  try { await DB.batch([DB.prepare('DELETE FROM auth_tokens WHERE expires_at < ?').bind(t - 86400_000), DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t)]); } catch (e) {}
  const { results } = await DB.prepare("SELECT q.*, a.actions, a.name, a.active, a.conditions, a.trigger FROM automation_queue q JOIN automations a ON a.id = q.automation_id WHERE q.status = 'waiting' AND q.run_at <= ? ORDER BY q.run_at LIMIT 25").bind(t).all();
  for (const q of results) {
    const claimed = await DB.prepare("UPDATE automation_queue SET status = 'running', attempts = attempts + 1 WHERE id = ? AND status = 'waiting'").bind(q.id).run();
    if (!claimed.meta || !claimed.meta.changes) continue;
    if (q.active) await runAutomation(env, { id: q.automation_id, name: q.name, actions: q.actions, conditions: '[]' }, await loadCtx(env, parse(q.ctx, {})), q.step);
    await DB.prepare("UPDATE automation_queue SET status = 'done' WHERE id = ?").bind(q.id).run();
  }
  // idle deals, checked at most hourly
  const { results: idle } = await DB.prepare("SELECT * FROM automations WHERE active = 1 AND trigger = 'deal.idle'").all();
  for (const a of idle) {
    const days = Math.max(1, +a.trigger_value || 7), cut = new Date(t - days * 86400_000).toISOString();
    const { results: deals } = await DB.prepare(`SELECT d.id, d.title FROM crm_deals d WHERE d.stage NOT IN ('won','lost') AND d.updated_at < ?
      AND NOT EXISTS (SELECT 1 FROM automation_log l WHERE l.automation_id = ? AND l.subject = d.title AND l.created_at > ?) LIMIT 10`).bind(cut, a.id, cut).all();
    for (const d of deals) await runAutomation(env, a, await loadCtx(env, { event: 'deal.idle', deal_id: d.id }), 0);
  }
  await DB.prepare("DELETE FROM automation_queue WHERE status = 'done' AND created_at < ?").bind(new Date(t - 30 * 86400_000).toISOString()).run();
  return results.length;
}

// ---------- Recipes (one click) ----------
export const RECIPES = [
  { key: 'speed', name: 'Speed to lead', trigger: 'lead.received', conditions: [], actions: [
    { type: 'set_owner', owner: 'round_robin' }, { type: 'create_task', title: 'Call {{contact.name}} within the hour', due_days: 0, assignee: 'owner', priority: true },
    { type: 'send_email', subject: 'Thanks {{first_name}}, we are on it', body: 'Hi {{first_name}},\n\nThanks for reaching out to Delegance. A real person is reviewing your request now and will reply shortly.\n\nIf it helps, you can also book a call at a time that suits you: https://delegance.app/book' }] },
  { key: 'won', name: 'Won deal onboarding', trigger: 'deal.won', conditions: [], actions: [
    { type: 'add_tag', tag: 'client' }, { type: 'create_task', title: 'Kickoff call with {{contact.name}}', due_days: 1, assignee: 'owner', priority: true },
    { type: 'send_email', subject: 'Welcome to Delegance, {{first_name}}', body: 'Hi {{first_name}},\n\nWelcome aboard! We are setting up your team now. Expect a kickoff invite within one business day.' },
    { type: 'notify', to: 'admins', title: 'New client: {{contact.company}}' }] },
  { key: 'lost', name: 'Lost deal nurture', trigger: 'deal.lost', conditions: [], actions: [
    { type: 'add_tag', tag: 'nurture' }, { type: 'wait', hours: 720 }, { type: 'create_task', title: 'Check back in with {{contact.name}}', due_days: 0, assignee: 'owner' }] },
  { key: 'idle', name: 'Stale deal nudge', trigger: 'deal.idle', trigger_value: '7', conditions: [], actions: [
    { type: 'notify', to: 'owner', title: 'Deal going quiet: {{deal.title}}' }, { type: 'create_task', title: 'Re-engage: {{deal.title}}', due_days: 0, assignee: 'owner' }] },
  { key: 'booking', name: 'Booked call prep', trigger: 'booking.created', conditions: [], actions: [
    { type: 'create_task', title: 'Prepare for call with {{contact.name}}', due_days: 0, assignee: 'owner' }, { type: 'add_tag', tag: 'booked-call' }] },
  { key: 'proposal', name: 'Proposal follow-up', trigger: 'deal.stage_changed', trigger_value: 'proposal', conditions: [], actions: [
    { type: 'wait', hours: 48 }, { type: 'create_task', title: 'Follow up on proposal: {{deal.title}}', due_days: 0, assignee: 'owner', priority: true }] },
];

// ---------- Admin routes: automations + webhooks ----------
const SHARING = ['private', 'view', 'edit'];
export async function autoRoutes(path, m, req, env, me) {
  const DB = env.DB, p = path.split('/');
  if (p[0] !== 'automations' && p[0] !== 'webhooks') return null;
  if (!can(me, 'admin')) return bad('Only admins can change automations and webhooks.', 403);
  if (p[0] === 'automations') {
    if (!p[1] && m === 'GET') {
      const { results } = await DB.prepare("SELECT a.*, u.name owner_name FROM automations a LEFT JOIN users u ON u.id = a.created_by WHERE a.created_by = ? OR a.sharing IN ('view','edit') ORDER BY a.created_at DESC").bind(me.id).all();
      const { results: users } = await DB.prepare("SELECT id, name FROM users WHERE role IN ('staff','admin','super_admin') AND status = 'active' ORDER BY name").all();
      return json({ items: results.map(a => ({ ...a, mine: a.created_by === me.id, can_edit: a.created_by === me.id || a.sharing === 'edit', conditions: parse(a.conditions, []), actions: parse(a.actions, []) })), events: EVENTS, fields: FIELDS, actions: ACTIONS, stages: DEAL_STAGES, recipes: RECIPES.map(r => ({ key: r.key, name: r.name, trigger: r.trigger })), team: users });
    }
    if (p[1] === 'log' && m === 'GET') {
      const { results } = await DB.prepare("SELECT l.*, a.name FROM automation_log l JOIN automations a ON a.id = l.automation_id WHERE a.created_by = ? OR a.sharing IN ('view','edit') ORDER BY l.created_at DESC LIMIT 100").bind(me.id).all();
      return json({ items: results });
    }
    if (!p[1] && m === 'POST') {
      const b = await body(req);
      const r = b.recipe ? RECIPES.find(x => x.key === b.recipe) : null;
      const f = validate(r || b); if (typeof f === 'string') return bad(f);
      const id = uid('au_'), t = now();
      await DB.prepare('INSERT INTO automations (id, name, active, trigger, trigger_value, conditions, actions, created_by, created_at, updated_at, sharing) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .bind(id, f.name, 1, f.trigger, f.trigger_value, JSON.stringify(f.conditions), JSON.stringify(f.actions), me.id, t, t, SHARING.includes(b.sharing) ? b.sharing : 'private').run();
      await audit(env, me.email, 'automation.create', f.name);
      return json({ ok: true, id }, 201);
    }
    const a = p[1] && await DB.prepare('SELECT * FROM automations WHERE id = ?').bind(p[1]).first();
    const mine = a && a.created_by === me.id;
    if (!a || (!mine && a.sharing === 'private')) return bad('Automation not found.', 404);
    if (m !== 'GET' && !mine && a.sharing !== 'edit') return bad('This workflow is shared view-only. Ask its owner to share it with edit rights.', 403);
    if (m === 'DELETE' && !mine) return bad('Only the owner can delete this workflow.', 403);
    if (m === 'PATCH') {
      const b = await body(req);
      if ('sharing' in b && b.sharing !== a.sharing) { if (!mine) return bad('Only the owner can change who sees this workflow.', 403); if (!SHARING.includes(b.sharing)) return bad('Pick private, view or edit.'); await DB.prepare('UPDATE automations SET sharing = ?, updated_at = ? WHERE id = ?').bind(b.sharing, now(), a.id).run(); }
      delete b.sharing; if (!Object.keys(b).length) return json({ ok: true });
      if (Object.keys(b).length === 1 && 'active' in b) { await DB.prepare('UPDATE automations SET active = ?, updated_at = ? WHERE id = ?').bind(b.active ? 1 : 0, now(), a.id).run(); return json({ ok: true }); }
      const f = validate(b); if (typeof f === 'string') return bad(f);
      await DB.prepare('UPDATE automations SET name = ?, trigger = ?, trigger_value = ?, conditions = ?, actions = ?, updated_at = ? WHERE id = ?').bind(f.name, f.trigger, f.trigger_value, JSON.stringify(f.conditions), JSON.stringify(f.actions), now(), a.id).run();
      await audit(env, me.email, 'automation.update', f.name);
      return json({ ok: true });
    }
    if (m === 'DELETE') { await DB.batch([DB.prepare('DELETE FROM automations WHERE id = ?').bind(a.id), DB.prepare('DELETE FROM automation_queue WHERE automation_id = ?').bind(a.id)]); await audit(env, me.email, 'automation.delete', a.name); return json({ ok: true }); }
    if (p[2] === 'test' && m === 'POST') {
      const b = await body(req);
      const c = b.contact_id ? { contact_id: b.contact_id } : b.deal_id ? { deal_id: b.deal_id } : {};
      await runAutomation(env, a, await loadCtx(env, { event: a.trigger, ...c }), 0);
      const last = await DB.prepare('SELECT status, detail FROM automation_log WHERE automation_id = ? ORDER BY created_at DESC LIMIT 1').bind(a.id).first();
      return json({ ok: true, result: last });
    }
    return null;
  }
  // webhooks
  if (!p[1] && m === 'GET') { const { results } = await DB.prepare("SELECT id, name, url, events, active, created_at, last_status, last_at, fails, sharing, created_by = ? mine FROM webhooks WHERE created_by = ? OR sharing IN ('view','edit') ORDER BY created_at DESC").bind(me.id, me.id).all(); return json({ items: results.map(h => ({ ...h, events: parse(h.events, ['*']) })), events: EVENTS }); }
  if (!p[1] && m === 'POST') {
    const b = await body(req), url = safeUrl(clean(b.url, 500));
    if (!url) return bad('Use a full https:// address from Zapier, Make, n8n or GoHighLevel.');
    const evs = (Array.isArray(b.events) && b.events.length ? b.events : ['*']).filter(e => e === '*' || EVENTS[e]);
    const secret = 'whsec_' + [...crypto.getRandomValues(new Uint8Array(18))].map(x => x.toString(16).padStart(2, '0')).join('');
    await DB.prepare('INSERT INTO webhooks (id, name, url, events, secret, created_by, created_at, sharing) VALUES (?,?,?,?,?,?,?,?)').bind(uid('wh_'), clean(b.name, 80) || new URL(url).hostname, url, JSON.stringify(evs), secret, me.id, now(), SHARING.includes(b.sharing) ? b.sharing : 'private').run();
    await audit(env, me.email, 'webhook.create', url);
    return json({ ok: true, secret }, 201);
  }
  const hk = p[1] && await DB.prepare('SELECT * FROM webhooks WHERE id = ?').bind(p[1]).first();
  if (p[1] && (!hk || (hk.created_by !== me.id && hk.sharing !== 'edit'))) return bad('Not found.', 404);
  if (p[1] && m === 'DELETE' && hk.created_by !== me.id) return bad('Only the owner can delete this webhook.', 403);
  if (p[1] && p[2] === 'test' && m === 'POST') {
    const h = hk;
    const st = await post(h.url, { event: 'test', data: { message: 'Hello from Delegance. Your webhook works.' }, sent_at: now() }, h.secret);
    await DB.prepare('UPDATE webhooks SET last_status = ?, last_at = ? WHERE id = ?').bind(typeof st === 'number' ? st : 0, now(), h.id).run();
    return json({ ok: typeof st === 'number' && st < 400, status: st });
  }
  if (p[1] && m === 'PATCH') { const b = await body(req); await DB.prepare('UPDATE webhooks SET active = ?, fails = 0 WHERE id = ?').bind(b.active ? 1 : 0, p[1]).run(); return json({ ok: true }); }
  if (p[1] && m === 'DELETE') { await DB.prepare('DELETE FROM webhooks WHERE id = ?').bind(p[1]).run(); await audit(env, me.email, 'webhook.delete', p[1]); return json({ ok: true }); }
  return null;
}
function validate(b) {
  const name = clean(b.name, 80); if (!name) return 'Give the automation a name.';
  if (!EVENTS[b.trigger]) return 'Pick a trigger.';
  const conditions = (Array.isArray(b.conditions) ? b.conditions : []).filter(c => FIELDS.includes(c.field) && ['equals', 'not_equals', 'contains', 'gte', 'lte', 'exists', 'missing'].includes(c.op)).slice(0, 10).map(c => ({ field: c.field, op: c.op, value: clean(c.value, 120) }));
  const actions = (Array.isArray(b.actions) ? b.actions : []).filter(s => ACTIONS.includes(s.type)).slice(0, 15).map(s => {
    const o = { type: s.type };
    for (const k of ['title', 'subject', 'tag', 'stage', 'assignee', 'owner', 'to', 'url', 'secret']) if (s[k] != null && s[k] !== '') o[k] = clean(s[k], k === 'url' ? 500 : 200);
    if (s.body != null) o.body = clean(s.body, 4000);
    for (const k of ['due_days', 'hours', 'value_usd']) if (s[k] !== undefined && s[k] !== '') o[k] = Math.max(0, +s[k] || 0);
    if (s.priority) o.priority = true;
    return o;
  });
  if (!actions.length) return 'Add at least one action.';
  if (actions.some(s => s.type === 'webhook' && !safeUrl(s.url))) return 'Webhook actions need a full https:// address.';
  return { name, trigger: b.trigger, trigger_value: clean(b.trigger_value, 40) || null, conditions, actions };
}
