// Hermes MCP (POST /api/mcp/hermes): a narrow, PII-free toolset for Eron's local Hermes Agent.
// Hermes runs on free models whose prompts may be used for training, so nothing here returns client details.
// Only: Eron's own unlinked tasks, Delegance Page DRAFT posts (never published or scheduled here), internal notes,
// deal counts per stage. No contacts, emails, phones, message bodies, contracts, deletes, sending or payments.
// Auth: Bearer token from its own hermes_keys table (sha256 hash only), so these tokens never work on the
// main CRM MCP or REST API, and CRM keys never work here. 120 calls/hour per token; every call is audited.
// This file is a more specific Pages route than ../[[path]].js, which stays unchanged.
import { now, uid, clean, json, sha256, audit, limited, can } from '../_lib.js';

const PAGE = 'a_595ab71866bc414aab93'; // Delegance Facebook Page in Delegance Desk
const NOTEBOOK = 'ct_hermes_notebook'; // internal CRM record that holds Hermes notes (no personal data)
const S = { type: 'string' };
const T = (name, description, properties = {}, required = [], write = false) => ({ name, description, inputSchema: { type: 'object', properties, required }, write });

const HERMES_TOOLS = [
  T('list_my_tasks', "List Eron's open tasks (tasks not linked to a client).", { include_done: { type: 'boolean' } }),
  T('create_my_task', 'Create a task for Eron.', { title: S, due: { type: 'string', description: 'YYYY-MM-DD' }, priority: { type: 'boolean' } }, ['title'], true),
  T('complete_my_task', 'Mark one of these tasks done.', { id: S }, ['id'], true),
  T('list_draft_posts', 'List draft social posts for the Delegance Page (drafts only).'),
  T('create_draft_post', 'Save a DRAFT post for the Delegance Page. It is never published or scheduled; Eron reviews it in Delegance Desk.', { body: S, title: S, link_url: S }, ['body'], true),
  T('update_draft_post', 'Edit a draft post for the Delegance Page. Only the fields you pass change. It stays a draft.', { id: S, body: S, title: S, link_url: S }, ['id'], true),
  T('add_internal_note', 'Add an internal note to the Delegance team notebook.', { body: S }, ['body'], true),
  T('pipeline_summary', 'Number of deals in each pipeline stage (counts only).'),
];

// Strip anything that looks like an email address or phone number from free text we hand back.
const scrub = s => s == null ? s : String(s).replace(/[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi, '[email]').replace(/\+?\d[\d\s().-]{7,}\d/g, '[number]');
const day = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null;
const link = v => { const l = clean(v, 1000); if (l && !/^https:\/\//i.test(l)) throw new Error('The link must start with https://'); return l || null; };
// Drafts Hermes may see: draft posts whose only target is the Delegance Page.
const MY_DRAFT = `p.status = 'draft' AND EXISTS (SELECT 1 FROM post_targets t WHERE t.post_id = p.id AND t.account_id = '${PAGE}') AND NOT EXISTS (SELECT 1 FROM post_targets t WHERE t.post_id = p.id AND t.account_id != '${PAGE}')`;
// Tasks Hermes may see: assigned to the key owner and not linked to any contact or deal.
const MY_TASK = 'assignee_id = ? AND contact_id IS NULL AND deal_id IS NULL';

async function run(name, a, env, me) {
  const DB = env.DB, t = now();
  switch (name) {
    case 'list_my_tasks': {
      const { results } = await DB.prepare(`SELECT id, title, due, status, priority FROM crm_tasks WHERE ${MY_TASK} ${a.include_done ? '' : "AND status = 'open'"} ORDER BY status = 'done', due IS NULL, due, created_at DESC LIMIT 100`).bind(me.id).all();
      return { tasks: results.map(x => ({ id: x.id, title: scrub(x.title), due: x.due, status: x.status, priority: !!x.priority })) };
    }
    case 'create_my_task': {
      const title = clean(a.title, 200); if (!title) throw new Error('Add a title.');
      const id = uid('tk_');
      await DB.prepare('INSERT INTO crm_tasks (id, title, assignee_id, due, status, priority, client_visible, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,0,?,?,?)').bind(id, title, me.id, day(a.due), 'open', a.priority ? 1 : 0, me.id, t, t).run();
      return { ok: true, id };
    }
    case 'complete_my_task': {
      const r = await DB.prepare(`UPDATE crm_tasks SET status = 'done', updated_at = ? WHERE id = ? AND ${MY_TASK}`).bind(t, clean(a.id, 40), me.id).run();
      if (!(r.meta && r.meta.changes)) throw new Error('Task not found.');
      return { ok: true };
    }
    case 'list_draft_posts': {
      const { results } = await DB.prepare(`SELECT p.id, p.title, p.body, p.link_url, p.updated_at FROM posts p WHERE ${MY_DRAFT} ORDER BY p.updated_at DESC LIMIT 50`).all();
      return { drafts: results.map(x => ({ ...x, body: scrub(x.body) })) };
    }
    case 'create_draft_post': {
      const body = clean(a.body, 5000); if (!body) throw new Error('Write the post first.');
      const id = uid('p_');
      await DB.batch([
        DB.prepare("INSERT INTO posts (id, body, networks, status, scheduled_at, title, link_url, created_by, created_at, updated_at) VALUES (?,?,'[\"facebook\"]','draft',NULL,?,?,?,?,?)").bind(id, body, clean(a.title, 100) || null, link(a.link_url), me.email, t, t),
        DB.prepare("INSERT INTO post_targets (id, post_id, account_id, status, updated_at) VALUES (?,?,?,'pending',?)").bind(uid('t_'), id, PAGE, t),
      ]);
      return { ok: true, id, status: 'draft' };
    }
    case 'update_draft_post': {
      const id = clean(a.id, 40);
      const cur = await DB.prepare(`SELECT p.body, p.title, p.link_url FROM posts p WHERE p.id = ? AND ${MY_DRAFT}`).bind(id).first();
      if (!cur) throw new Error('Draft not found (only Delegance Page drafts can be edited).');
      const body = a.body !== undefined ? clean(a.body, 5000) : cur.body; if (!body) throw new Error('The post cannot be empty.');
      const title = a.title !== undefined ? clean(a.title, 100) || null : cur.title, url = a.link_url !== undefined ? link(a.link_url) : cur.link_url;
      await DB.prepare("UPDATE posts SET body = ?, title = ?, link_url = ?, updated_at = ? WHERE id = ? AND status = 'draft'").bind(body, title, url, t, id).run();
      return { ok: true, id, status: 'draft' };
    }
    case 'add_internal_note': {
      const body = clean(a.body, 4000); if (!body) throw new Error('Write the note first.');
      await DB.prepare("INSERT OR IGNORE INTO crm_contacts (id, name, source, stage, kind, tags, created_at, updated_at, last_activity) VALUES (?, 'Hermes notebook (internal)', 'Hermes', 'new', 'partner', '[\"internal\"]', ?, ?, ?)").bind(NOTEBOOK, t, t, t).run();
      const id = uid('nt_');
      await DB.prepare("INSERT INTO crm_notes (id, contact_id, author_id, author_name, visibility, body, created_at, kind) VALUES (?,?,?,?,'internal',?,?,'note')").bind(id, NOTEBOOK, me.id, 'Hermes', body, t).run();
      return { ok: true, id };
    }
    case 'pipeline_summary': {
      const { results } = await DB.prepare('SELECT stage, COUNT(*) n FROM crm_deals GROUP BY stage').all();
      const stages = Object.fromEntries(['new', 'contacted', 'call', 'proposal', 'negotiation', 'won', 'lost'].map(s => [s, 0]));
      for (const r of results) if (r.stage in stages) stages[r.stage] = r.n;
      return { stages, open: stages.new + stages.contacted + stages.call + stages.proposal + stages.negotiation };
    }
  }
  throw new Error('Unknown tool');
}


async function keyOwner(env, raw) {
  if (!/^dlh_[A-Za-z0-9_-]{40,}$/.test(raw || '')) return null;
  const k = await env.DB.prepare("SELECT k.id kid, k.last_used, u.* FROM hermes_keys k JOIN users u ON u.id = k.user_id WHERE k.hash = ? AND k.revoked_at IS NULL AND u.status = 'active'").bind(await sha256(raw)).first();
  if (!k || !can(k, 'staff')) return null;
  if (!k.last_used || Date.now() - Date.parse(k.last_used) > 300_000) await env.DB.prepare('UPDATE hermes_keys SET last_used = ? WHERE id = ?').bind(now(), k.kid).run();
  return k;
}

const INFO = { serverInfo: { name: 'delegance-hermes', title: 'Delegance (Hermes)', version: '1.0.0' },
  instructions: "Delegance busywork helper for Eron: his own tasks, DRAFT posts for the Delegance Page (never published here), internal notes and pipeline counts. No client details are available." };

export async function onRequest({ request: req, env }) {
  if (!env.DB) return json({ error: 'Not configured yet.' }, 503);
  const bearer = ((req.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/i) || [])[1];
  const me = await keyOwner(env, bearer);
  if (!me) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized.' } }, 401, { 'WWW-Authenticate': 'Bearer' });
  if (req.method === 'DELETE') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  if (Number(req.headers.get('content-length') || 0) > 64 * 1024) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } }, 413);
  let msg; try { msg = await req.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
  const one = async x => {
    if (!x || x.jsonrpc !== '2.0' || typeof x.method !== 'string') return { jsonrpc: '2.0', id: x && x.id || null, error: { code: -32600, message: 'Invalid request' } };
    const id = x.id, ok = result => ({ jsonrpc: '2.0', id, result }), fail = text => ok({ content: [{ type: 'text', text }], isError: true });
    if (x.method.startsWith('notifications/')) return null;
    if (x.method === 'initialize') return ok({ protocolVersion: (x.params && x.params.protocolVersion) || '2025-06-18', capabilities: { tools: { listChanged: false } }, ...INFO });
    if (x.method === 'ping') return ok({});
    if (x.method === 'tools/list') return ok({ tools: HERMES_TOOLS.map(({ write, ...t }) => ({ ...t, annotations: { readOnlyHint: !write, destructiveHint: false } })) });
    if (x.method !== 'tools/call') return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + x.method } };
    const name = x.params && x.params.name, a = (x.params && x.params.arguments) || {};
    if (!HERMES_TOOLS.some(t => t.name === name)) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool: ' + name } };
    if (await limited(env, 'hermes:' + me.kid, 120, 3600)) return fail('Rate limit reached (120 calls an hour). Try again later.');
    try {
      const r = await run(name, a && typeof a === 'object' ? a : {}, env, me);
      await audit(env, 'hermes:' + me.kid, 'hermes.' + name, 'ok');
      return ok({ content: [{ type: 'text', text: JSON.stringify(r, null, 1).slice(0, 60000) }], structuredContent: r });
    } catch (e) {
      await audit(env, 'hermes:' + me.kid, 'hermes.' + name, 'error');
      return fail('Error: ' + (e && e.message || 'failed'));
    }
  };
  try {
    if (Array.isArray(msg)) { const out = (await Promise.all(msg.slice(0, 20).map(one))).filter(Boolean); return out.length ? json(out) : new Response(null, { status: 202 }); }
    const r = await one(msg);
    return r ? json(r) : new Response(null, { status: 202 });
  } catch (e) { console.error('hermes mcp', e && e.stack || e); return json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } }, 500); }
}
