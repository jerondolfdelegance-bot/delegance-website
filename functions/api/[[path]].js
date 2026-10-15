// Delegance Accounts + CRM API: one router for /api/*.
import { ROLES, ROLE_NAMES, STAGES, now, uid, sha256, hashPassword, same, passwordProblem, json, bad, clean, cleanEmail, parse, body, limited, audit,
  startSession, clearCookie, endSession, currentUser, can, publicUser, makeLink, checkTotp, newTotpSecret, recoveryCodes, seal, unseal, needsMfa,
  sendEmail, mailReady, teamInbox, humanOk, SEEN, hiddenFrom, ACCENTS } from './_lib.js';
import { crmRoutes, notificationRoutes, notify, adminIds, newDeal, logActivity } from './_crm.js';
import { emit, runDue, autoRoutes } from './_auto.js';
import { keyUser, integrationRoutes, leadHook, mcp, bookingPublic } from './_int.js';
import { socialRoutes, outreachRoutes, contractRoutes, contractPublic, desk as deskBridge } from './_v4.js';
import { teamRoutes } from './_team.js';
const KEY_BLOCKED = /^(users|auth\/|apikeys|leadhooks|automations|webhooks|booking\/settings|audit|candidates|announcements|social|outreach|contracts|chat|people|updates|roadmap)/;

const DUMMY = { hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', salt: 'AAAAAAAAAAAAAAAAAAAAAA==' };
const TEAM = ['staff', 'admin', 'super_admin'];

export async function onRequest(ctx) {
  const { request: req, env } = ctx;
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const m = req.method;
  if (!env.DB) return bad('Not configured yet.', 503);
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const bearer = ((req.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/i) || [])[1];
  const lazyCron = async () => { if (!(await limited(env, 'lazycron', 1, 120))) ctx.waitUntil(runDue(env).catch(e => console.error('cron', e && e.message))); };
  try {
    // Machine endpoints: scheduler, lead capture, Claude MCP, API keys. No cookies, so no CSRF check.
    if (path === 'health') { let desk = false; try { desk = !!(await deskBridge(env, 'ping', {}, null)).ok; } catch {} return json({ ok: true, desk, email: mailReady(env) }); }
    if (path === 'cron') { if (await limited(env, 'cron:' + ip, 30, 3600)) return bad('Too many.', 429); const n = await runDue(env); return json({ ok: true, ran: n }); }
    if (path.startsWith('hooks/')) return await leadHook(req, env, path.slice(6), ctx);
    if (path === 'mcp' || path.startsWith('mcp/')) {
      const me = await keyUser(env, path.length > 4 ? path.slice(4) : bearer);
      if (!me) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Add a valid Delegance API key (Bearer token or /api/mcp/<key>).' } }, 401, { 'WWW-Authenticate': 'Bearer' });
      await lazyCron();
      return await mcp(req, env, me, ctx, internalCaller(env, me, ctx));
    }
    if (bearer) {
      const me = await keyUser(env, bearer);
      if (!me) return bad('Invalid API key.', 401);
      if (KEY_BLOCKED.test(path)) return bad('This part of the API is only available in the dashboard.', 403);
      if (me.readonly && m !== 'GET') return bad('This API key is read-only.', 403);
      if (await limited(env, 'key:' + me.kid, 600, 3600)) return bad('Rate limit: 600 requests per hour per key.', 429);
      await lazyCron();
      return (await privateRoutes(path, m, req, env, me, url, ctx)) || bad('Not found.', 404);
    }
  } catch (e) { console.error('api error', path, e && e.stack || e); return bad('Something went wrong on our side. Please try again.', 500); }
  if (m !== 'GET' && m !== 'HEAD') {
    const o = req.headers.get('Origin');
    if (o && o !== url.origin) return bad('Blocked: request did not come from delegance.app.', 403);
    if (!o && req.headers.get('Sec-Fetch-Site') && req.headers.get('Sec-Fetch-Site') !== 'same-origin') return bad('Blocked.', 403);
  }
  try {
    const bk = path === 'book' || path === 'book/cancel' ? await bookingPublic(path, m, req, env, ip, ctx) : null;
    if (bk) return bk;
    const ck = await contractPublic(path, m, req, env, ip);
    if (ck) return ck;
    const pub = await publicRoutes(path, m, req, env, ip, ctx);
    if (pub) return pub;
    const me = await currentUser(env, req);
    if (!me) return bad('Please sign in.', 401);
    await lazyCron();
    // Team accounts must turn on 2-step sign-in before anything else.
    if (needsMfa(me) && !me.totp_enabled && !/^auth\/(me|logout|totp\/(start|confirm))$/.test(path)) return json({ error: 'Turn on 2-step sign-in to continue.', code: 'mfa_setup' }, 403);
    return (await privateRoutes(path, m, req, env, me, url, ctx)) || bad('Not found.', 404);
  } catch (e) {
    console.error('api error', path, e && e.stack || e);
    return bad('Something went wrong on our side. Please try again.', 500);
  }
}

// Lets the MCP server reuse every API route with the key owner's permissions.
function internalCaller(env, me, ctx) {
  return async (method, pathQ, data) => {
    const u = new URL('https://delegance.app/api/' + pathQ);
    const r = new Request(u, { method, headers: data !== undefined ? { 'Content-Type': 'application/json' } : {}, body: data !== undefined ? JSON.stringify(data) : undefined });
    const res = await privateRoutes(u.pathname.replace(/^\/api\/?/, '').replace(/\/$/, ''), method, r, env, me, u, ctx);
    if (!res) throw new Error('Not found');
    const j = await res.json().catch(() => ({}));
    if (res.status >= 400) throw new Error(j.error || 'Request failed (' + res.status + ')');
    return j;
  };
}

// ---------------- Public: sign in, sign up, links, website requests ----------------
async function publicRoutes(path, m, req, env, ip, ctx) {
  const DB = env.DB;
  const later = p => ctx && ctx.waitUntil ? ctx.waitUntil(p) : p;
  if (path === 'config' && m === 'GET') return json({ turnstile: env.TURNSTILE_SITE_KEY || null, email: mailReady(env) });
  if (path === 'auth/login' && m === 'POST') {
    const b = await body(req);
    const email = cleanEmail(b.email), pw = String(b.password || '');
    if (await limited(env, 'login-ip:' + ip, 30, 900)) return bad('Too many sign-in attempts. Please wait 15 minutes.', 429);
    if (!email || !pw) return bad('Enter your email and password.');
    if (await limited(env, 'login-em:' + email, 10, 900)) return bad('Too many sign-in attempts. Please wait 15 minutes.', 429);
    const u = await DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    const h = await hashPassword(pw.slice(0, 200), u && u.pass_salt || DUMMY.salt);
    if (u && u.locked_until && u.locked_until > Date.now()) return bad('This account is paused for 15 minutes after too many wrong passwords.', 429);
    if (!u || !u.pass_hash || u.status !== 'active' || !same(h.hash, u.pass_hash)) {
      if (u) {
        const f = (u.failed || 0) + 1;
        await DB.prepare('UPDATE users SET failed = ?, locked_until = ? WHERE id = ?').bind(f, f >= 8 ? Date.now() + 900_000 : null, u.id).run();
        await audit(env, email, 'auth.login_failed', ip);
      }
      return bad(u && u.status === 'disabled' ? 'This account is turned off. Contact admin@delegance.app.' : 'Email or password is incorrect.', 401);
    }
    if (u.totp_enabled) {
      await DB.prepare('UPDATE users SET failed = 0 WHERE id = ?').bind(u.id).run();
      return json({ mfa: true, ticket: await makeLink(env, u.id, 'mfa', 5 / 60) });
    }
    const cookie = await startSession(env, req, u);
    await audit(env, email, 'auth.login', ip);
    return json({ ok: true, user: publicUser(u) }, 200, { 'Set-Cookie': cookie });
  }
  if (path === 'auth/login-code' && m === 'POST') {
    const b = await body(req), tid = await sha256(String(b.ticket || ''));
    if (await limited(env, 'mfa-ip:' + ip, 30, 900) || await limited(env, 'mfa:' + tid, 6, 600)) return bad('Too many tries. Sign in again in a few minutes.', 429);
    const row = await DB.prepare("SELECT t.id tid, t.expires_at, t.used_at, u.* FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.id = ? AND t.kind = 'mfa'").bind(tid).first();
    if (!row || row.used_at || row.expires_at < Date.now() || row.status !== 'active') return bad('That sign-in expired. Please enter your password again.', 410);
    const code = String(b.code || '').trim().toLowerCase();
    let ok = false;
    const step = await checkTotp(await unseal(env, row.totp_secret), code, row.totp_step);
    if (step) { ok = true; await DB.prepare('UPDATE users SET totp_step = ? WHERE id = ?').bind(step, row.id).run(); }
    else if (/^[a-z2-7]{4}-?[a-z2-7]{4}$/.test(code)) {
      const h = await sha256(code.replace('-', '')), list = parse(row.recovery, []);
      if (list.includes(h)) { ok = true; await DB.prepare('UPDATE users SET recovery = ? WHERE id = ?').bind(JSON.stringify(list.filter(x => x !== h)), row.id).run(); await audit(env, row.email, 'auth.recovery_code_used', ip); }
    }
    if (!ok) { await audit(env, row.email, 'auth.code_failed', ip); return bad('That code is not right. Check the time on your phone and try the newest code.', 401); }
    await DB.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ?').bind(now(), row.tid).run();
    const cookie = await startSession(env, req, row);
    await audit(env, row.email, 'auth.login', ip + ' (2-step)');
    return json({ ok: true }, 200, { 'Set-Cookie': cookie });
  }
  if (path === 'auth/forgot' && m === 'POST') {
    const b = await body(req), email = cleanEmail(b.email);
    const done = json({ ok: true, email: mailReady(env) });
    if (await limited(env, 'forgot-ip:' + ip, 8, 3600)) return bad('Too many requests. Please wait an hour.', 429);
    if (!email || await limited(env, 'forgot:' + email, 3, 3600)) return done;
    if (!(await humanOk(env, b.turnstile, ip))) return bad('Please complete the "I am human" check.', 400);
    const u = await DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    if (!u || u.status === 'disabled') return done;
    const invite = !u.pass_hash, link = await makeLink(env, u.id, invite ? 'invite' : 'reset', invite ? 24 * 7 : 1, 'self');
    later(sendEmail(env, invite
      ? { to: email, subject: 'Finish setting up your Delegance account', intro: `Hi ${u.name.split(' ')[0]},\n\nYou asked for a sign-in link. Choose a password to finish setting up your account.`, button: 'Set my password', link, outro: 'This link works once and expires in 7 days. If you did not ask for it, you can ignore this email.' }
      : { to: email, subject: 'Reset your Delegance password', intro: `Hi ${u.name.split(' ')[0]},\n\nSomeone (hopefully you) asked to reset the password for ${email}.`, button: 'Choose a new password', link, outro: 'This link works once and expires in 1 hour. If you did not ask for it, ignore this email: your password stays the same.' }));
    await audit(env, email, 'auth.forgot', ip);
    return done;
  }
  if (path === 'auth/signup' && m === 'POST') {
    const b = await body(req);
    if (b.website) return json({ ok: true });
    if (await limited(env, 'signup:' + ip, 5, 3600)) return bad('Too many sign-ups from this connection. Please try later.', 429);
    const name = clean(b.name, 80), email = cleanEmail(b.email);
    if (!name || !email) return bad('Enter your name and a valid email.');
    if (!b.consent) return bad('Please agree to the terms and privacy policy.');
    const p = passwordProblem(b.password, email); if (p) return bad(p);
    if (!(await humanOk(env, b.turnstile, ip))) return bad('Please complete the "I am human" check.', 400);
    if (await DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) return bad('That email already has an account. Sign in instead, or ask us to reset your password.', 409);
    const h = await hashPassword(String(b.password)), t = now();
    const u = { id: uid('u_'), email, name, role: 'member', status: 'active' };
    const intent = ['hire', 'work', 'both'].includes(b.intent) ? b.intent : null;
    await DB.prepare('INSERT INTO users (id, email, name, role, status, pass_hash, pass_salt, created_at, updated_at, intent) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(u.id, email, name, 'member', 'active', h.hash, h.salt, t, t, intent).run();
    await audit(env, email, 'auth.signup', ip);
    later(sendEmail(env, { to: email, subject: 'Welcome to Delegance', intro: intent === 'work' || intent === 'both' ? `Hi ${name.split(' ')[0]},\n\nWelcome to Delegance! Next step: build your VA portfolio. It goes live on the Delegance job board as soon as you submit, and clients can message you from it.` : `Hi ${name.split(' ')[0]},\n\nYour free Delegance account is ready. Browse our virtual assistants, read the guides, and send us a request whenever you are ready to delegate.`, button: intent === 'work' || intent === 'both' ? 'Build my portfolio' : 'Open my dashboard', link: intent === 'work' || intent === 'both' ? 'https://delegance.app/apply' : 'https://delegance.app/dashboard', outro: 'Questions? Just reply to this email.' }));
    return json({ ok: true }, 201, { 'Set-Cookie': await startSession(env, req, u) });
  }
  if (path === 'auth/logout' && m === 'POST') { await endSession(env, req); return json({ ok: true }, 200, { 'Set-Cookie': clearCookie }); }
  if ((path === 'auth/link' || path === 'auth/set-password') && m === 'POST') {
    const b = await body(req);
    if (await limited(env, 'link:' + ip, 30, 900)) return bad('Too many tries. Please wait a little.', 429);
    const row = await DB.prepare('SELECT t.id tid, t.kind, t.expires_at, t.used_at, u.* FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.id = ?').bind(await sha256(String(b.token || ''))).first();
    if (!row || row.used_at || row.expires_at < Date.now() || row.status === 'disabled') return bad('This link has expired or was already used. Ask your Delegance admin for a new one.', 410);
    if (path === 'auth/link') return json({ kind: row.kind, email: row.email, name: row.name, role_name: ROLE_NAMES[row.role] });
    const p = passwordProblem(b.password, row.email); if (p) return bad(p);
    const h = await hashPassword(String(b.password)), name = clean(b.name, 80) || row.name;
    await DB.batch([
      DB.prepare("UPDATE users SET pass_hash = ?, pass_salt = ?, name = ?, status = 'active', failed = 0, locked_until = NULL, updated_at = ? WHERE id = ?").bind(h.hash, h.salt, name, now(), row.id),
      DB.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ?').bind(now(), row.tid),
      DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.id),
    ]);
    await audit(env, row.email, row.kind === 'invite' ? 'auth.invite_accepted' : 'auth.password_reset', ip);
    return json({ ok: true }, 200, { 'Set-Cookie': await startSession(env, req, row) });
  }
  // The "Start a request" planner on the home page: becomes a lead in the CRM.
  if (path === 'request' && m === 'POST') {
    const b = await body(req);
    if (b.website) return json({ ok: true });
    if (await limited(env, 'req:' + ip, 5, 3600)) return bad('Too many requests from this connection. Please email admin@delegance.app.', 429);
    const name = clean(b.name, 80), email = cleanEmail(b.email);
    if (!name || !email) return bad('Add your name and email so we can reply.');
    if (!(await humanOk(env, b.turnstile, ip))) return bad('Please complete the "I am human" check.', 400);
    const needs = (Array.isArray(b.needs) ? b.needs : []).map(x => clean(x, 60)).filter(Boolean).slice(0, 10);
    const details = [needs.length ? 'Needs: ' + needs.join(', ') : '', b.when ? 'Start: ' + clean(b.when, 60) : '', b.how ? 'Amount: ' + clean(b.how, 60) : '', clean(b.message, 1500)].filter(Boolean).join('\n');
    const contactId = await upsertLead(env, { name, email, company: clean(b.company, 120), source: 'Website request' }, later);
    const t = now();
    await DB.prepare('INSERT INTO crm_requests (id, contact_id, title, details, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(uid('rq_'), contactId, needs.length ? needs.slice(0, 3).join(', ') : 'New request', details, 'new', t, t).run();
    await audit(env, email, 'crm.web_request', contactId);
    const openDeal = await DB.prepare("SELECT id FROM crm_deals WHERE contact_id = ? AND stage NOT IN ('won','lost')").bind(contactId).first();
    const webDeal = openDeal ? openDeal.id : await newDeal(env, { title: (clean(b.company, 80) || name) + ' · ' + (needs.slice(0, 2).join(', ') || 'New request'), contact_id: contactId, source: 'Website request' });
    later(emit(env, 'lead.received', { contact_id: contactId, deal_id: webDeal, request: { title: needs.join(', ') || 'New request', details } }));
    await logActivity(env, { contact_id: contactId, body: 'Website request:\n' + (details || 'New request') });
    later(notify(env, await adminIds(env), { title: `New request from ${name}`, body: needs.join(', ') || clean(b.message, 140), link: '#contact/' + contactId }));
    later(Promise.all([
      sendEmail(env, { to: email, subject: 'We got your request', intro: `Hi ${name.split(' ')[0]},\n\nThanks for reaching out to Delegance. Your request is with our team and we will reply to this email, usually within one business day.\n\nWhat you sent:\n${details || 'New request'}`, button: 'Create a free account', link: 'https://delegance.app/login', outro: 'With an account you can follow your requests and message the team in one place.' }),
      sendEmail(env, { to: teamInbox(env), subject: `New request: ${name}${b.company ? ' (' + clean(b.company, 80) + ')' : ''}`, intro: `${name} <${email}> sent a request from the website.\n\n${details}`, button: 'Open in the CRM', link: 'https://delegance.app/dashboard#contact/' + contactId, replyTo: email }),
    ]));
    return json({ ok: true }, 201);
  }
  return null;
}

async function upsertLead(env, { name, email, company, source }, later) {
  const ex = email && await env.DB.prepare('SELECT id FROM crm_contacts WHERE email = ? ORDER BY created_at LIMIT 1').bind(email).first();
  if (ex) { await env.DB.prepare('UPDATE crm_contacts SET updated_at = ?, company = COALESCE(company, ?) WHERE id = ?').bind(now(), company || null, ex.id).run(); return ex.id; }
  const id = uid('ct_'), t = now();
  await env.DB.prepare('INSERT INTO crm_contacts (id, name, company, email, source, stage, kind, created_at, updated_at, last_activity) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id, name, company || null, email || null, source, 'new', 'lead', t, t, t).run();
  if (later) later(emit(env, 'contact.created', { contact_id: id }));
  return id;
}

// ---------------- Signed in ----------------
async function privateRoutes(path, m, req, env, me, url, ctx) {
  const DB = env.DB, p = path.split('/'), isTeam = can(me, 'staff');
  const who = me.email;
  const later = x => ctx && ctx.waitUntil ? ctx.waitUntil(x) : x;
  const first = n => String(n || '').split(' ')[0];

  // ----- 2-step sign-in -----
  if (path === 'auth/totp/start' && m === 'POST') {
    if (me.totp_enabled) return bad('2-step sign-in is already on.');
    const secret = newTotpSecret();
    await DB.prepare('UPDATE users SET totp_pending = ? WHERE id = ?').bind(await seal(env, secret), me.id).run();
    return json({ secret, uri: `otpauth://totp/Delegance:${encodeURIComponent(me.email)}?secret=${secret}&issuer=Delegance&digits=6&period=30` });
  }
  if (path === 'auth/totp/confirm' && m === 'POST') {
    const b = await body(req);
    if (await limited(env, 'totpc:' + me.id, 10, 900)) return bad('Too many tries. Please wait a little.', 429);
    if (!me.totp_pending) return bad('Start the setup again.');
    const secret = await unseal(env, me.totp_pending), step = await checkTotp(secret, b.code, 0);
    if (!step) return bad('That code is not right. Type the newest 6-digit code from the app.');
    const codes = recoveryCodes();
    await DB.prepare('UPDATE users SET totp_secret = ?, totp_pending = NULL, totp_enabled = 1, totp_step = ?, recovery = ?, updated_at = ? WHERE id = ?')
      .bind(me.totp_pending, step, JSON.stringify(await Promise.all(codes.map(c => sha256(c.replace('-', ''))))), now(), me.id).run();
    await audit(env, who, 'auth.2step_on');
    later(sendEmail(env, { to: me.email, subject: '2-step sign-in is on', intro: `Hi ${first(me.name)},\n\n2-step sign-in is now on for your Delegance account. From now on you will enter a 6-digit code from your authenticator app after your password.`, outro: 'If this was not you, contact admin@delegance.app right away.' }));
    return json({ ok: true, recovery: codes });
  }
  if (path === 'auth/totp/recovery' && m === 'POST') {
    const b = await body(req);
    if (!me.totp_enabled) return bad('Turn on 2-step sign-in first.');
    if (await limited(env, 'totpc:' + me.id, 10, 900)) return bad('Too many tries. Please wait a little.', 429);
    const step = await checkTotp(await unseal(env, me.totp_secret), b.code, me.totp_step);
    if (!step) return bad('That code is not right.');
    const codes = recoveryCodes();
    await DB.prepare('UPDATE users SET recovery = ?, totp_step = ? WHERE id = ?').bind(JSON.stringify(await Promise.all(codes.map(c => sha256(c.replace('-', ''))))), step, me.id).run();
    await audit(env, who, 'auth.recovery_codes_new');
    return json({ ok: true, recovery: codes });
  }
  if (path === 'auth/totp/disable' && m === 'POST') {
    const b = await body(req);
    if (needsMfa(me)) return bad('Team accounts must keep 2-step sign-in on.');
    if (await limited(env, 'totpc:' + me.id, 10, 900)) return bad('Too many tries. Please wait a little.', 429);
    const step = me.totp_enabled && await checkTotp(await unseal(env, me.totp_secret), b.code, me.totp_step);
    if (!step) return bad('That code is not right.');
    await DB.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, recovery = NULL WHERE id = ?').bind(me.id).run();
    await audit(env, who, 'auth.2step_off');
    return json({ ok: true });
  }
  if (path === 'auth/sessions' && m === 'GET') {
    const { results } = await DB.prepare('SELECT id, created_at, last_seen, ua, place FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY COALESCE(last_seen, created_at) DESC').bind(me.id, Date.now()).all();
    return json({ items: results.map(x => ({ id: x.id.slice(0, 16), current: x.id === me.sid, created_at: x.created_at, last_seen: x.last_seen || x.created_at, place: x.place, device: device(x.ua) })) });
  }
  if (p[0] === 'auth' && p[1] === 'sessions' && p[2] && m === 'DELETE') {
    await DB.prepare('DELETE FROM sessions WHERE user_id = ? AND substr(id, 1, 16) = ? AND id != ?').bind(me.id, p[2], me.sid).run();
    return json({ ok: true });
  }
  if (path === 'auth/notify' && m === 'POST') { const b = await body(req); await DB.prepare('UPDATE users SET notify = ? WHERE id = ?').bind(b.on ? 1 : 0, me.id).run(); return json({ ok: true }); }

  if (path === 'auth/me') return json({ user: { ...publicUser(me), notify: !!me.notify }, email: mailReady(env) });
  if (path === 'auth/password' && m === 'POST') {
    const b = await body(req);
    if (await limited(env, 'pw:' + me.id, 10, 3600)) return bad('Too many tries. Please wait.', 429);
    const h = await hashPassword(String(b.current || '').slice(0, 200), me.pass_salt || DUMMY.salt);
    if (!me.pass_hash || !same(h.hash, me.pass_hash)) return bad('Your current password is not right.');
    const prob = passwordProblem(b.password, me.email); if (prob) return bad(prob);
    const n = await hashPassword(String(b.password));
    await DB.batch([DB.prepare('UPDATE users SET pass_hash = ?, pass_salt = ?, updated_at = ? WHERE id = ?').bind(n.hash, n.salt, now(), me.id), DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(me.id, me.sid)]);
    await audit(env, who, 'auth.password_changed');
    return json({ ok: true });
  }
  if (path === 'auth/logout-all' && m === 'POST') { await DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(me.id).run(); return json({ ok: true }, 200, { 'Set-Cookie': clearCookie }); }
  if (path === 'auth/prefs' && m === 'POST') {
    const b = await body(req); if (!['auto', 'light', 'dark'].includes(b.theme)) return bad('Pick auto, light or dark.');
    await DB.prepare('UPDATE users SET theme = ? WHERE id = ?').bind(b.theme, me.id).run();
    return json({ ok: true });
  }
  if (path === 'auth/intent' && m === 'POST') {
    const b = await body(req); if (!['hire', 'work', 'both'].includes(b.intent)) return bad('Pick hire, work or both.');
    await DB.prepare('UPDATE users SET intent = ?, updated_at = ? WHERE id = ?').bind(b.intent, now(), me.id).run();
    return json({ ok: true });
  }
  if (path === 'auth/profile' && m === 'POST') {
    const b = await body(req); const name = clean(b.name, 80);
    if (!name) return bad('Enter your name.');
    let avatar = me.avatar || null;
    if (b.avatar === '' || b.avatar === null) avatar = null;
    else if (typeof b.avatar === 'string') {
      if (!/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(b.avatar) || b.avatar.length > 200000) return bad('Use a JPG, PNG or WebP photo (we shrink it for you).');
      avatar = b.avatar;
    }
    await DB.prepare('UPDATE users SET name = ?, title = ?, bio = ?, phone = ?, location = ?, accent = ?, avatar = ?, updated_at = ? WHERE id = ?')
      .bind(name, clean(b.title, 80) || null, clean(b.bio, 400) || null, clean(b.phone, 40) || null, clean(b.location, 80) || null, ACCENTS.includes(b.accent) ? b.accent : null, avatar, now(), me.id).run();
    return json({ ok: true });
  }

  if (path === 'dash') return json(await dashboard(env, me));

  // ----- Announcements -----
  if (path === 'announcements' && m === 'GET') return json({ items: await announcementsFor(env, me, 50) });
  if (path === 'announcements' && m === 'POST' && can(me, 'admin')) {
    const b = await body(req); const title = clean(b.title, 120), text = clean(b.body, 2000), aud = ['all', 'team', 'va', 'client', 'member'].includes(b.audience) ? b.audience : 'all';
    if (!title || !text) return bad('Add a title and a message.');
    await DB.prepare('INSERT INTO announcements (id, title, body, audience, author_name, created_at) VALUES (?,?,?,?,?,?)').bind(uid('an_'), title, text, aud, me.name, now()).run();
    await audit(env, who, 'announce.create', title);
    return json({ ok: true }, 201);
  }
  if (p[0] === 'announcements' && p[1] && m === 'DELETE' && can(me, 'admin')) { await DB.prepare('DELETE FROM announcements WHERE id = ?').bind(p[1]).run(); return json({ ok: true }); }

  // ----- People (admin+) -----
  if (p[0] === 'users' && can(me, 'admin')) return users(p, m, req, env, me);

  // ----- VA applications (admin+) -----
  if (p[0] === 'candidates' && can(me, 'admin')) {
    if (!p[1] && m === 'GET') {
      // Open job board: new profiles go live at once; admins verify the good ones or hide the rest.
      const st = ['new', 'verified', 'hidden', 'pending'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'new';
      const where = { new: "status = 'approved' AND verified = 0", verified: "status = 'approved' AND verified = 1", hidden: "status = 'rejected'", pending: "status = 'pending'" }[st];
      const { results } = await DB.prepare(`SELECT id, slug, name, headline, location, years, availability, status, verified, created_at, updated_at FROM candidates WHERE ${where} ORDER BY updated_at DESC LIMIT 200`).all();
      const counts = await DB.prepare("SELECT SUM(status = 'approved' AND verified = 0) new, SUM(status = 'approved' AND verified = 1) verified, SUM(status = 'rejected') hidden, SUM(status = 'pending') pending FROM candidates").first();
      return json({ items: results, counts });
    }
    if (p[1] && m === 'POST') {
      const b = await body(req); if (!['approved', 'rejected', 'pending'].includes(b.status)) return bad('Pick verify, show or hide.');
      await DB.prepare("UPDATE candidates SET status = ?, verified = ?, review_note = ?, approved_at = CASE WHEN ? = 'approved' THEN COALESCE(approved_at, ?) ELSE approved_at END WHERE id = ?").bind(b.status, b.status === 'approved' && b.verified ? 1 : 0, clean(b.note, 500) || null, b.status, now(), p[1]).run();
      await audit(env, who, 'candidate.' + (b.verified ? 'verify' : b.status), p[1]);
      return json({ ok: true });
    }
  }

  if (path === 'contacts.csv' && can(me, 'admin')) {
    const { results } = await DB.prepare('SELECT c.name, c.company, c.email, c.phone, c.country, c.source, c.stage, c.kind, c.value_usd, u.name owner, c.created_at, c.updated_at FROM crm_contacts c LEFT JOIN users u ON u.id = c.owner_id WHERE ' + SEEN('c') + ' ORDER BY c.created_at').bind(me.id).all();
    const cols = ['name', 'company', 'email', 'phone', 'country', 'source', 'stage', 'kind', 'value_usd', 'owner', 'created_at', 'updated_at'];
    const cell = v => { v = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    await audit(env, who, 'crm.export', results.length + ' contacts');
    return new Response([cols.join(','), ...results.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="delegance-contacts-${now().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
  }
  const nr = await notificationRoutes(path, m, req, env, me); if (nr) return nr;
  const ar = await autoRoutes(path, m, req, env, me); if (ar) return ar;
  const ir = await integrationRoutes(path, m, req, env, me); if (ir) return ir;
  const tr = await teamRoutes(path, m, req, env, me); if (tr) return tr;
  const sr = (await socialRoutes(path, m, req, env, me, url)) || (await outreachRoutes(path, m, req, env, me)) || (await contractRoutes(path, m, req, env, me)); if (sr) return sr;
  const cr = await crmRoutes(path, m, req, env, me, url, later); if (cr) return cr;
  // ----- Contacts / pipeline (team) -----
  if (p[0] === 'contacts' && isTeam) return contacts(p, m, req, env, me, url, ctx);

  // ----- Tasks -----
  if (p[0] === 'tasks') return tasks(p, m, req, env, me, url, ctx);

  // ----- Requests -----
  if (p[0] === 'requests') {
    if (!p[1] && m === 'GET') {
      if (isTeam) { const { results } = await DB.prepare('SELECT r.*, c.name contact_name, c.company FROM crm_requests r LEFT JOIN crm_contacts c ON c.id = r.contact_id ORDER BY CASE r.status WHEN \'new\' THEN 0 WHEN \'in_progress\' THEN 1 ELSE 2 END, r.created_at DESC LIMIT 300').all(); return json({ items: results }); }
      if (!me.contact_id) return json({ items: [] });
      const { results } = await DB.prepare('SELECT id, title, details, status, created_at, updated_at FROM crm_requests WHERE contact_id = ? AND user_id IS NOT NULL ORDER BY created_at DESC LIMIT 100').bind(me.contact_id).all();
      return json({ items: results });
    }
    if (!p[1] && m === 'POST' && (me.role === 'client' || me.role === 'member')) {
      const b = await body(req); const title = clean(b.title, 140), details = clean(b.details, 3000);
      if (!title) return bad('Give your request a short title.');
      if (await limited(env, 'ureq:' + me.id, 20, 86400)) return bad('That is a lot of requests for one day. Message us instead.', 429);
      let cid = me.contact_id;
      if (!cid) { cid = await upsertLead(env, { name: me.name, email: me.email, source: 'Member request' }, later); await DB.prepare('UPDATE users SET contact_id = ? WHERE id = ?').bind(cid, me.id).run(); }
      const t = now();
      await DB.prepare('INSERT INTO crm_requests (id, contact_id, user_id, title, details, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(uid('rq_'), cid, me.id, title, details || null, 'new', t, t).run();
      await DB.prepare('UPDATE crm_contacts SET updated_at = ? WHERE id = ?').bind(t, cid).run();
      await audit(env, who, 'request.create', title);
      later(notify(env, await adminIds(env), { title: `${me.name} sent a request`, body: title, link: '#contact/' + cid }));
      later(emit(env, 'request.created', { contact_id: cid, request: { title, details: details || null, from: me.name } }));
      later(sendEmail(env, { to: teamInbox(env), subject: `New request from ${me.name}: ${title}`, intro: `${me.name} (${ROLE_NAMES[me.role]}) sent a request from their dashboard.\n\n${title}${details ? '\n\n' + details : ''}`, button: 'Open in the CRM', link: 'https://delegance.app/dashboard#contact/' + cid, replyTo: me.email }));
      return json({ ok: true }, 201);
    }
    if (p[1] && m === 'PATCH' && isTeam) {
      const b = await body(req); if (!['new', 'in_progress', 'done', 'closed'].includes(b.status)) return bad('Unknown status.');
      await DB.prepare('UPDATE crm_requests SET status = ?, updated_at = ? WHERE id = ?').bind(b.status, now(), p[1]).run();
      const r = await DB.prepare("SELECT r.title, u.email, u.name, u.notify FROM crm_requests r JOIN users u ON u.id = r.user_id WHERE r.id = ? AND u.status = 'active'").bind(p[1]).first();
      if (r && r.notify && ['in_progress', 'done'].includes(b.status)) later(sendEmail(env, { to: r.email, subject: b.status === 'done' ? `Done: ${r.title}` : `We are working on: ${r.title}`, intro: `Hi ${first(r.name)},\n\n${b.status === 'done' ? 'Your request is done' : 'Your request is now in progress'}: "${r.title}".`, button: 'See your requests', link: 'https://delegance.app/dashboard#requests' }));
      return json({ ok: true });
    }
  }

  // ----- Client <-> Delegance messages (client-visible notes) -----
  if (path === 'messages' && (me.role === 'client' || me.role === 'member')) {
    if (!me.contact_id) return json({ items: [] });
    if (m === 'GET') { const { results } = await DB.prepare("SELECT author_name, author_id, body, created_at FROM crm_notes WHERE contact_id = ? AND visibility = 'client' ORDER BY created_at LIMIT 300").bind(me.contact_id).all(); return json({ items: results.map(n => ({ from: n.author_id === me.id ? 'you' : 'delegance', name: n.author_id === me.id ? 'You' : n.author_name, body: n.body, at: n.created_at })) }); }
    if (m === 'POST') {
      const b = await body(req); const text = clean(b.body, 3000); if (!text) return bad('Type a message first.');
      if (await limited(env, 'msg:' + me.id, 60, 3600)) return bad('Slow down a little, please.', 429);
      await DB.prepare("INSERT INTO crm_notes (id, contact_id, author_id, author_name, visibility, body, created_at) VALUES (?,?,?,?, 'client', ?, ?)").bind(uid('nt_'), me.contact_id, me.id, me.name, text, now()).run();
      await DB.prepare('UPDATE crm_contacts SET updated_at = ? WHERE id = ?').bind(now(), me.contact_id).run();
      await DB.prepare('UPDATE crm_contacts SET last_activity = ? WHERE id = ?').bind(now(), me.contact_id).run();
      const own = await DB.prepare('SELECT owner_id FROM crm_contacts WHERE id = ?').bind(me.contact_id).first();
      later(notify(env, own && own.owner_id ? [own.owner_id] : await adminIds(env), { title: `Message from ${me.name}`, body: text.slice(0, 200), link: '#contact/' + me.contact_id }));
      later(emit(env, 'message.received', { contact_id: me.contact_id, message: { from: me.name, body: text } }));
      const owner = await DB.prepare("SELECT u.email FROM crm_contacts c JOIN users u ON u.id = c.owner_id WHERE c.id = ? AND u.status = 'active' AND u.notify = 1").bind(me.contact_id).first();
      later(sendEmail(env, { to: owner ? owner.email : teamInbox(env), subject: `Message from ${me.name}`, intro: `${me.name} wrote:\n\n${text}`, button: 'Reply in the CRM', link: 'https://delegance.app/dashboard#contact/' + me.contact_id, replyTo: me.email }));
      return json({ ok: true }, 201);
    }
  }

  // ----- VA: assigned clients + timesheet -----
  if (path === 'va/clients' && me.role === 'va') {
    const { results } = await DB.prepare('SELECT c.id, c.name, c.company, c.country FROM va_assignments a JOIN crm_contacts c ON c.id = a.contact_id WHERE a.va_id = ? ORDER BY c.name').bind(me.id).all();
    return json({ items: results });
  }
  if (p[0] === 'timesheets' && (me.role === 'va' || isTeam)) {
    if (m === 'GET') {
      const va = isTeam && url.searchParams.get('va') ? url.searchParams.get('va') : (isTeam ? null : me.id);
      const { results } = await DB.prepare(`SELECT t.*, c.name contact_name, u.name va_name FROM timesheets t LEFT JOIN crm_contacts c ON c.id = t.contact_id LEFT JOIN users u ON u.id = t.va_id ${va ? 'WHERE t.va_id = ?' : ''} ORDER BY t.day DESC, t.created_at DESC LIMIT 300`).bind(...(va ? [va] : [])).all();
      return json({ items: results });
    }
    if (m === 'POST' && me.role === 'va') {
      const b = await body(req); const minutes = Math.round(Number(b.hours) * 60), day = /^\d{4}-\d{2}-\d{2}$/.test(b.day) ? b.day : now().slice(0, 10);
      if (!(minutes > 0 && minutes <= 960)) return bad('Hours must be between 0.1 and 16.');
      if (b.contact_id && !(await DB.prepare('SELECT 1 FROM va_assignments WHERE va_id = ? AND contact_id = ?').bind(me.id, b.contact_id).first())) return bad('That client is not assigned to you.');
      await DB.prepare('INSERT INTO timesheets (id, va_id, contact_id, day, minutes, note, created_at) VALUES (?,?,?,?,?,?,?)').bind(uid('ts_'), me.id, b.contact_id || null, day, minutes, clean(b.note, 300) || null, now()).run();
      return json({ ok: true }, 201);
    }
    if (p[1] && m === 'DELETE') { await DB.prepare(`DELETE FROM timesheets WHERE id = ? ${isTeam ? '' : 'AND va_id = ?'}`).bind(...(isTeam ? [p[1]] : [p[1], me.id])).run(); return json({ ok: true }); }
  }

  // ----- Super admin -----
  if (path === 'audit' && can(me, 'super_admin')) {
    const { results } = await DB.prepare('SELECT actor, action, detail, created_at FROM audit ORDER BY id DESC LIMIT 200').all();
    return json({ items: results });
  }
  if (path === 'team' && isTeam) {
    const { results } = await DB.prepare("SELECT id, name, role FROM users WHERE role IN ('staff','admin','super_admin','va') AND status = 'active' ORDER BY name").all();
    return json({ items: results });
  }
  if (path === 'chats' && isTeam) {
    const { results } = await DB.prepare('SELECT id, channel, contact_name, last_preview, last_message_at FROM conversations ORDER BY last_message_at DESC LIMIT 15').all();
    return json({ items: results });
  }
  return null;
}

async function announcementsFor(env, me, n) {
  const aud = ['all', TEAM.includes(me.role) ? 'team' : me.role];
  const q = can(me, 'admin') ? 'SELECT * FROM announcements ORDER BY created_at DESC LIMIT ?' : 'SELECT * FROM announcements WHERE audience IN (?, ?) ORDER BY created_at DESC LIMIT ?';
  const { results } = await (can(me, 'admin') ? env.DB.prepare(q).bind(n) : env.DB.prepare(q).bind(aud[0], aud[1], n)).all();
  return results;
}

// ---------------- People ----------------
async function users(p, m, req, env, me) {
  const DB = env.DB, sup = me.role === 'super_admin';
  const mayManage = target => sup ? true : ROLES[target.role] < ROLES.admin;
  const mayGive = role => ROLES[role] != null && (sup || ROLES[role] < ROLES.admin);
  if (!p[1] && m === 'GET') {
    const { results } = await DB.prepare('SELECT * FROM users ORDER BY CASE role WHEN \'super_admin\' THEN 0 WHEN \'admin\' THEN 1 WHEN \'staff\' THEN 2 WHEN \'va\' THEN 3 WHEN \'client\' THEN 4 ELSE 5 END, name').all();
    const { results: cands } = await DB.prepare("SELECT id, name, slug FROM candidates WHERE status = 'approved' ORDER BY name LIMIT 300").all();
    const { results: cons } = await DB.prepare('SELECT id, name, company FROM crm_contacts ORDER BY name LIMIT 500').all();
    return json({ items: results.map(publicUser), candidates: cands, contacts: cons, can_give: Object.keys(ROLES).filter(mayGive) });
  }
  if (!p[1] && m === 'POST') {
    const b = await body(req); const email = cleanEmail(b.email), name = clean(b.name, 80), role = b.role;
    if (!email || !name) return bad('Enter a name and a valid email.');
    if (!mayGive(role)) return bad('You cannot give that role.', 403);
    if (await DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) return bad('That email already has an account.', 409);
    let contact = b.contact_id || null;
    if (role === 'client' && !contact) contact = await upsertLead(env, { name, email, company: clean(b.company, 120), source: 'Invited client' });
    if (role === 'client') await DB.prepare("UPDATE crm_contacts SET kind = 'client', stage = CASE WHEN stage IN ('won','lost') THEN stage ELSE 'won' END WHERE id = ?").bind(contact).run();
    const id = uid('u_'), t = now();
    await DB.prepare("INSERT INTO users (id, email, name, role, status, title, candidate_id, contact_id, created_at, updated_at) VALUES (?,?,?,?, 'invited', ?,?,?,?,?)").bind(id, email, name, role, clean(b.title, 80) || null, role === 'va' ? (b.candidate_id || null) : null, role === 'client' ? contact : null, t, t).run();
    const link = await makeLink(env, id, 'invite', 24 * 7, me.email);
    await audit(env, me.email, 'user.invite', `${email} as ${role}`);
    const emailed = await sendEmail(env, { to: email, subject: `${me.name} invited you to Delegance`, intro: `Hi ${name.split(' ')[0]},\n\n${me.name} added you to Delegance as ${ROLE_NAMES[role]}. Choose a password to open your dashboard.`, button: 'Accept the invite', link, outro: 'This link works once and expires in 7 days.' });
    return json({ ok: true, id, link, emailed }, 201);
  }
  const u = p[1] && await DB.prepare('SELECT * FROM users WHERE id = ?').bind(p[1]).first();
  if (!u) return bad('Person not found.', 404);
  if (!mayManage(u)) return bad('Only the super admin can change admins.', 403);
  if (u.id === me.id && (m === 'DELETE' || p[2] === 'sessions')) return bad('Use Account to manage your own sign-in.', 400);
  if (!p[2] && m === 'PATCH') {
    const b = await body(req);
    const role = b.role != null ? b.role : u.role, status = b.status != null ? b.status : u.status;
    if (role !== u.role && !mayGive(role)) return bad('You cannot give that role.', 403);
    if (!['active', 'disabled', 'invited'].includes(status)) return bad('Unknown status.');
    if (u.id === me.id && (role !== u.role || status !== 'active')) return bad('You cannot change your own role or turn yourself off.');
    if (u.role === 'super_admin' && role !== 'super_admin') { const n = await DB.prepare("SELECT COUNT(*) n FROM users WHERE role = 'super_admin' AND status = 'active'").first(); if (n.n <= 1) return bad('Delegance needs at least one super admin.'); }
    await DB.prepare('UPDATE users SET name = ?, title = ?, role = ?, status = ?, candidate_id = ?, contact_id = ?, updated_at = ? WHERE id = ?').bind(
      clean(b.name, 80) || u.name, b.title !== undefined ? (clean(b.title, 80) || null) : u.title, role, status,
      b.candidate_id !== undefined ? (b.candidate_id || null) : u.candidate_id, b.contact_id !== undefined ? (b.contact_id || null) : u.contact_id, now(), u.id).run();
    if (status === 'disabled' || role !== u.role) await DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id).run();
    await audit(env, me.email, 'user.update', `${u.email} role=${role} status=${status}`);
    return json({ ok: true });
  }
  if (p[2] === 'link' && m === 'POST') {
    const link = await makeLink(env, u.id, u.pass_hash ? 'reset' : 'invite', u.pass_hash ? 24 : 24 * 7, me.email);
    await audit(env, me.email, 'user.link', u.email);
    const emailed = await sendEmail(env, u.pass_hash
      ? { to: u.email, subject: 'Reset your Delegance password', intro: `Hi ${first(u.name)},\n\n${me.name} sent you a link to choose a new password.`, button: 'Choose a new password', link, outro: 'This link works once and expires in 24 hours.' }
      : { to: u.email, subject: `${me.name} invited you to Delegance`, intro: `Hi ${first(u.name)},\n\nYou were added to Delegance as ${ROLE_NAMES[u.role]}. Choose a password to open your dashboard.`, button: 'Accept the invite', link, outro: 'This link works once and expires in 7 days.' });
    return json({ ok: true, link, emailed });
  }
  if (p[2] === 'mfa' && m === 'DELETE') {
    await DB.batch([DB.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_pending = NULL, recovery = NULL WHERE id = ?').bind(u.id), DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id)]);
    await audit(env, me.email, 'user.2step_reset', u.email);
    return json({ ok: true });
  }
  if (p[2] === 'sessions' && m === 'DELETE') { await DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id).run(); await audit(env, me.email, 'user.signout_all', u.email); return json({ ok: true }); }
  if (!p[2] && m === 'DELETE' && sup) {
    if (u.role === 'super_admin') return bad('Change their role first.');
    await DB.batch([DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id), DB.prepare('DELETE FROM auth_tokens WHERE user_id = ?').bind(u.id), DB.prepare('DELETE FROM va_assignments WHERE va_id = ?').bind(u.id), DB.prepare('DELETE FROM users WHERE id = ?').bind(u.id)]);
    await audit(env, me.email, 'user.delete', u.email);
    return json({ ok: true });
  }
  return null;
}

// ---------------- Contacts ----------------
async function contacts(p, m, req, env, me, url, ctx) {
  const DB = env.DB, later = x => ctx && ctx.waitUntil ? ctx.waitUntil(x) : x;
  if (!p[1] && m === 'GET') {
    const q = clean(url.searchParams.get('q'), 80), st = url.searchParams.get('stage');
    const where = [SEEN('c')], args = [me.id];
    if (q) { where.push('(c.name LIKE ? OR c.company LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
    if (STAGES.includes(st)) { where.push('c.stage = ?'); args.push(st); }
    const kind = url.searchParams.get('kind'), tag = clean(url.searchParams.get('tag'), 30), own = url.searchParams.get('owner');
    if (['lead', 'client', 'partner'].includes(kind)) { where.push('c.kind = ?'); args.push(kind); }
    if (tag) { where.push('c.tags LIKE ?'); args.push(`%"${tag.replace(/[%_"]/g, '')}"%`); }
    if (own === 'me') { where.push('c.owner_id = ?'); args.push(me.id); }
    const { results } = await DB.prepare(`SELECT c.*, u.name owner_name, (SELECT COUNT(*) FROM crm_deals d WHERE d.contact_id = c.id AND d.stage NOT IN ('won','lost')) open_deals,
      (SELECT COALESCE(SUM(value_usd),0) FROM crm_deals d WHERE d.contact_id = c.id AND d.stage NOT IN ('won','lost')) open_value
      FROM crm_contacts c LEFT JOIN users u ON u.id = c.owner_id WHERE ${where.join(' AND ')} ORDER BY COALESCE(c.last_activity, c.updated_at) DESC LIMIT 1000`).bind(...args).all();
    const { results: tagRows } = await DB.prepare("SELECT tags FROM crm_contacts WHERE tags != '[]'").all();
    const allTags = [...new Set(tagRows.flatMap(r => parse(r.tags, [])))].sort();
    return json({ items: results.map(c => ({ ...c, tags: parse(c.tags, []) })), tags: allTags });
  }
  if (!p[1] && m === 'POST') {
    const b = await body(req); const name = clean(b.name, 120);
    if (!name) return bad('Add a name.');
    const id = uid('ct_'), t = now();
    await DB.prepare('INSERT INTO crm_contacts (id, name, company, email, phone, country, source, stage, kind, owner_id, value_usd, tags, created_at, updated_at, private, linkedin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(
      id, name, clean(b.company, 120) || null, cleanEmail(b.email) || null, clean(b.phone, 40) || null, clean(b.country, 60) || null, clean(b.source, 60) || 'Manual',
      STAGES.includes(b.stage) ? b.stage : 'new', ['lead', 'client', 'partner'].includes(b.kind) ? b.kind : 'lead', me.id, Number.isFinite(+b.value_usd) && b.value_usd !== '' ? Math.max(0, Math.round(+b.value_usd)) : null, '[]', t, t, b.private ? 1 : 0, linkedinUrl(b.linkedin)).run();
    await audit(env, me.email, 'crm.contact_create', name);
    later(emit(env, 'contact.created', { contact_id: id }));
    return json({ ok: true, id }, 201);
  }
  const c = p[1] && await DB.prepare('SELECT * FROM crm_contacts WHERE id = ?').bind(p[1]).first();
  if (!c || await hiddenFrom(env, c, me)) return bad('Contact not found.', 404);
  if (!p[2] && m === 'GET') {
    const [notes, tks, reqs, vas, portal] = await Promise.all([
      DB.prepare('SELECT * FROM crm_notes WHERE contact_id = ? ORDER BY created_at DESC LIMIT 200').bind(c.id).all(),
      DB.prepare('SELECT t.*, u.name assignee_name FROM crm_tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.contact_id = ? ORDER BY t.status = \'done\', t.due IS NULL, t.due').bind(c.id).all(),
      DB.prepare('SELECT * FROM crm_requests WHERE contact_id = ? ORDER BY created_at DESC').bind(c.id).all(),
      DB.prepare('SELECT u.id, u.name FROM va_assignments a JOIN users u ON u.id = a.va_id WHERE a.contact_id = ?').bind(c.id).all(),
      DB.prepare('SELECT id, name, email, status FROM users WHERE contact_id = ?').bind(c.id).all(),
    ]);
    const { results: allVas } = await DB.prepare("SELECT id, name FROM users WHERE role = 'va' AND status != 'disabled' ORDER BY name").all();
    const { results: team } = await DB.prepare("SELECT id, name, role FROM users WHERE role IN ('staff','admin','super_admin','va') AND status = 'active' ORDER BY name").all();
    const { results: deals } = await DB.prepare('SELECT d.*, u.name owner_name FROM crm_deals d LEFT JOIN users u ON u.id = d.owner_id WHERE d.contact_id = ? ORDER BY d.stage IN (\'won\',\'lost\'), d.updated_at DESC').bind(c.id).all();
    return json({ contact: { ...c, tags: parse(c.tags, []) }, deals, notes: notes.results, tasks: tks.results, requests: reqs.results, vas: vas.results, portal: portal.results, all_vas: allVas, team });
  }
  if (!p[2] && m === 'PATCH') {
    const b = await body(req), f = { ...c };
    for (const k of ['name', 'company', 'phone', 'country', 'source']) if (b[k] !== undefined) f[k] = clean(b[k], 120) || (k === 'name' ? c.name : null);
    if (b.email !== undefined) f.email = cleanEmail(b.email) || null;
    if (STAGES.includes(b.stage)) f.stage = b.stage;
    if (['lead', 'client', 'partner'].includes(b.kind)) f.kind = b.kind;
    if (b.owner_id !== undefined) f.owner_id = b.owner_id || null;
    if (b.value_usd !== undefined) f.value_usd = b.value_usd === '' || b.value_usd == null ? null : Math.max(0, Math.round(+b.value_usd) || 0);
    if (Array.isArray(b.tags)) f.tags = JSON.stringify(b.tags.map(x => clean(x, 30)).filter(Boolean).slice(0, 12));
    if (b.linkedin !== undefined) f.linkedin = linkedinUrl(b.linkedin);
    if (b.private !== undefined) { if (c.owner_id && c.owner_id !== me.id && !can(me, 'super_admin')) return bad('Only the owner of this contact can make it private or shared.', 403); f.private = b.private ? 1 : 0; if (f.private && !f.owner_id) f.owner_id = me.id; }
    await DB.prepare('UPDATE crm_contacts SET name=?, company=?, email=?, phone=?, country=?, source=?, stage=?, kind=?, owner_id=?, value_usd=?, tags=?, linkedin=?, private=?, updated_at=? WHERE id=?')
      .bind(f.name, f.company, f.email, f.phone, f.country, f.source, f.stage, f.kind, f.owner_id, f.value_usd, typeof f.tags === 'string' ? f.tags : '[]', f.linkedin || null, f.private ? 1 : 0, now(), c.id).run();
    if (b.stage && b.stage !== c.stage) await DB.prepare("INSERT INTO crm_notes (id, contact_id, author_id, author_name, visibility, body, created_at) VALUES (?,?,?,?, 'internal', ?, ?)").bind(uid('nt_'), c.id, me.id, me.name, `Moved from ${c.stage} to ${b.stage}.`, now()).run();
    return json({ ok: true });
  }
  if (!p[2] && m === 'DELETE' && can(me, 'admin')) {
    await DB.batch(['crm_notes', 'crm_requests', 'va_assignments'].map(t => DB.prepare(`DELETE FROM ${t} WHERE contact_id = ?`).bind(c.id)).concat([
      DB.prepare('UPDATE crm_tasks SET contact_id = NULL WHERE contact_id = ?').bind(c.id), DB.prepare('UPDATE crm_deals SET contact_id = NULL WHERE contact_id = ?').bind(c.id), DB.prepare('UPDATE users SET contact_id = NULL WHERE contact_id = ?').bind(c.id), DB.prepare('DELETE FROM crm_contacts WHERE id = ?').bind(c.id)]));
    await audit(env, me.email, 'crm.contact_delete', c.name);
    return json({ ok: true });
  }
  if (p[2] === 'notes' && m === 'POST') {
    const b = await body(req); const text = clean(b.body, 3000); if (!text) return bad('Write a note first.');
    await logActivity(env, { contact_id: c.id, me, kind: ['call', 'meeting'].includes(b.kind) ? b.kind : 'note', body: text, visibility: b.visibility === 'client' ? 'client' : 'internal' });
    await DB.prepare('UPDATE crm_contacts SET updated_at = ? WHERE id = ?').bind(now(), c.id).run();
    if (b.visibility === 'client') {
      const { results: ppl } = await DB.prepare("SELECT email, name FROM users WHERE contact_id = ? AND status = 'active' AND notify = 1").bind(c.id).all();
      later(Promise.all(ppl.map(x => sendEmail(env, { to: x.email, subject: `New message from ${me.name} at Delegance`, intro: `Hi ${x.name.split(' ')[0]},\n\n${me.name} wrote:\n\n${text}`, button: 'Reply in your dashboard', link: 'https://delegance.app/dashboard#messages', replyTo: me.email }))));
    }
    return json({ ok: true }, 201);
  }
  if (p[2] === 'assign' && m === 'POST') {
    const b = await body(req);
    const va = await DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'va'").bind(String(b.va_id || '')).first();
    if (!va) return bad('Pick a virtual assistant.');
    if (b.on === false) await DB.prepare('DELETE FROM va_assignments WHERE va_id = ? AND contact_id = ?').bind(va.id, c.id).run();
    else await DB.prepare('INSERT OR IGNORE INTO va_assignments (va_id, contact_id, created_at) VALUES (?,?,?)').bind(va.id, c.id, now()).run();
    await audit(env, me.email, 'crm.assign', `${va.id} ${b.on === false ? '-' : '+'} ${c.id}`);
    return json({ ok: true });
  }
  return null;
}

// ---------------- Tasks ----------------
async function tasks(p, m, req, env, me, url, ctx) {
  const DB = env.DB, isTeam = can(me, 'staff'), later = x => ctx && ctx.waitUntil ? ctx.waitUntil(x) : x;
  if (!p[1] && m === 'GET') {
    if (me.role === 'client' || me.role === 'member') {
      if (!me.contact_id) return json({ items: [] });
      const { results } = await DB.prepare('SELECT id, title, due, status, updated_at FROM crm_tasks WHERE contact_id = ? AND client_visible = 1 ORDER BY status = \'done\', due IS NULL, due').bind(me.contact_id).all();
      return json({ items: results });
    }
    const mine = !isTeam || url.searchParams.get('mine') === '1';
    const { results } = await DB.prepare(`SELECT t.*, c.name contact_name, u.name assignee_name, d.title deal_title FROM crm_tasks t LEFT JOIN crm_contacts c ON c.id = t.contact_id LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN crm_deals d ON d.id = t.deal_id ${mine ? 'WHERE t.assignee_id = ?' : ''} ORDER BY t.status = 'done', t.priority DESC, t.due IS NULL, t.due, t.created_at DESC LIMIT 400`).bind(...(mine ? [me.id] : [])).all();
    return json({ items: results });
  }
  if (!p[1] && m === 'POST' && (isTeam || me.role === 'va')) {
    const b = await body(req); const title = clean(b.title, 200);
    if (!title) return bad('Write the task first.');
    if (me.role === 'va' && b.contact_id && !(await DB.prepare('SELECT 1 FROM va_assignments WHERE va_id = ? AND contact_id = ?').bind(me.id, b.contact_id).first())) return bad('That client is not assigned to you.');
    const t = now(), assignee = isTeam ? (b.assignee_id || me.id) : me.id;
    if (assignee !== me.id) { const a = await DB.prepare("SELECT email, name FROM users WHERE id = ? AND status = 'active' AND notify = 1").bind(assignee).first(); if (a) later(sendEmail(env, { to: a.email, subject: `New task: ${title}`, intro: `Hi ${a.name.split(' ')[0]},\n\n${me.name} gave you a task: "${title}"${/^\d{4}-\d{2}-\d{2}$/.test(b.due) ? ', due ' + b.due : ''}.`, button: 'Open my tasks', link: 'https://delegance.app/dashboard#tasks' })); }
    let contactId = b.contact_id || null, dealId = null;
    if (isTeam && b.deal_id) { const d = await DB.prepare('SELECT id, contact_id FROM crm_deals WHERE id = ?').bind(b.deal_id).first(); if (d) { dealId = d.id; contactId = contactId || d.contact_id; } }
    await DB.prepare('INSERT INTO crm_tasks (id, title, contact_id, deal_id, assignee_id, due, status, priority, client_visible, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(
      uid('tk_'), title, contactId, dealId, assignee, /^\d{4}-\d{2}-\d{2}$/.test(b.due) ? b.due : null, 'open', b.priority ? 1 : 0, b.client_visible ? 1 : 0, me.id, t, t).run();
    if (assignee !== me.id) later(notify(env, [assignee], { title: `${me.name} gave you a task`, body: title, link: '#tasks' }));
    return json({ ok: true }, 201);
  }
  const t = p[1] && await DB.prepare('SELECT * FROM crm_tasks WHERE id = ?').bind(p[1]).first();
  if (!t) return bad('Task not found.', 404);
  if (!isTeam && t.assignee_id !== me.id) return bad('That task is not yours.', 403);
  if (m === 'PATCH') {
    const b = await body(req);
    const status = ['open', 'doing', 'done'].includes(b.status) ? b.status : t.status;
    if (b.priority !== undefined) await DB.prepare('UPDATE crm_tasks SET priority = ? WHERE id = ?').bind(b.priority ? 1 : 0, t.id).run();
    if (status === 'done' && t.status !== 'done' && t.contact_id && isTeam) await logActivity(env, { contact_id: t.contact_id, deal_id: t.deal_id, me, body: `Task done: ${t.title}` });
    if (status === 'done' && t.status !== 'done') later(emit(env, 'task.completed', { contact_id: t.contact_id, deal_id: t.deal_id, task: { id: t.id, title: t.title, by: me.name } }));
    await DB.prepare('UPDATE crm_tasks SET status = ?, title = ?, due = ?, assignee_id = ?, client_visible = ?, updated_at = ? WHERE id = ?').bind(status, clean(b.title, 200) || t.title,
      b.due !== undefined ? (/^\d{4}-\d{2}-\d{2}$/.test(b.due) ? b.due : null) : t.due, isTeam && b.assignee_id !== undefined ? (b.assignee_id || null) : t.assignee_id,
      isTeam && b.client_visible !== undefined ? (b.client_visible ? 1 : 0) : t.client_visible, now(), t.id).run();
    return json({ ok: true });
  }
  if (m === 'DELETE' && (isTeam || t.created_by === me.id)) { await DB.prepare('DELETE FROM crm_tasks WHERE id = ?').bind(t.id).run(); return json({ ok: true }); }
  return null;
}

// ---------------- Home dashboards ----------------
async function dashboard(env, me) {
  const DB = env.DB, out = { user: publicUser(me), announcements: await announcementsFor(env, me, 5) };
  const one = async (sql, ...a) => (await DB.prepare(sql).bind(...a).first()) || {};
  const all = async (sql, ...a) => (await DB.prepare(sql).bind(...a).all()).results;
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  if (can(me, 'staff')) {
    out.pipeline = await all("SELECT stage, COUNT(*) n, COALESCE(SUM(value_usd),0) v FROM crm_deals GROUP BY stage");
    out.forecast = (await one("SELECT COALESCE(SUM(value_usd * COALESCE(probability, CASE stage WHEN 'new' THEN 10 WHEN 'contacted' THEN 20 WHEN 'call' THEN 40 WHEN 'proposal' THEN 60 WHEN 'negotiation' THEN 80 ELSE 0 END) / 100.0),0) w, COALESCE(SUM(value_usd),0) v FROM crm_deals WHERE stage NOT IN ('won','lost')"));
    out.won_month = (await one("SELECT COUNT(*) n, COALESCE(SUM(value_usd),0) v FROM crm_deals WHERE stage = 'won' AND closed_at >= ?", now().slice(0, 8) + '01'));
    out.stale = await all("SELECT d.id, d.title, d.stage, d.value_usd, d.updated_at FROM crm_deals d LEFT JOIN crm_contacts c ON c.id = d.contact_id WHERE d.stage NOT IN ('won','lost') AND d.updated_at < ? AND " + SEEN('c') + " ORDER BY d.updated_at LIMIT 5", new Date(Date.now() - 14 * 86400_000).toISOString(), me.id);
    out.today = (await one("SELECT SUM(due < ?) overdue, SUM(due = ?) today FROM crm_tasks WHERE assignee_id = ? AND status != 'done'", now().slice(0, 10), now().slice(0, 10), me.id));
    out.counts = {
      contacts: (await one('SELECT COUNT(*) n FROM crm_contacts')).n,
      new_this_week: (await one('SELECT COUNT(*) n FROM crm_contacts WHERE created_at > ?', weekAgo)).n,
      open_requests: (await one("SELECT COUNT(*) n FROM crm_requests WHERE status IN ('new','in_progress')")).n,
      my_tasks: (await one("SELECT COUNT(*) n FROM crm_tasks WHERE assignee_id = ? AND status != 'done'", me.id)).n,
      overdue: (await one("SELECT COUNT(*) n FROM crm_tasks WHERE status != 'done' AND due < ?", now().slice(0, 10))).n,
      chats_week: (await one('SELECT COUNT(*) n FROM conversations WHERE last_message_at > ?', weekAgo)).n,
    };
    out.my_tasks = await all("SELECT t.id, t.title, t.due, t.status, c.name contact_name, t.contact_id FROM crm_tasks t LEFT JOIN crm_contacts c ON c.id = t.contact_id WHERE t.assignee_id = ? AND t.status != 'done' ORDER BY t.due IS NULL, t.due LIMIT 8", me.id);
    out.requests = await all("SELECT r.id, r.title, r.status, r.created_at, c.name contact_name, r.contact_id FROM crm_requests r LEFT JOIN crm_contacts c ON c.id = r.contact_id WHERE r.status IN ('new','in_progress') ORDER BY r.created_at DESC LIMIT 6");
    out.recent = await all('SELECT c.id, c.name, c.company, c.kind, c.updated_at FROM crm_contacts c WHERE ' + SEEN('c') + ' ORDER BY COALESCE(c.last_activity, c.updated_at) DESC LIMIT 6', me.id);
    // Home: "next steps" checklist + a live feed so the dashboard feels lived-in.
    const dayStart = now().slice(0, 10);
    const [team, booking, autos, claude, accts, posts, firstMsg] = await Promise.all([
      one("SELECT COUNT(*) n FROM users WHERE role IN ('admin','staff') AND status != 'disabled' AND id != ?", me.id),
      one("SELECT 1 x FROM settings WHERE key = 'booking'"),
      one('SELECT COUNT(*) n FROM automations WHERE created_by = ? OR sharing != \'private\'', me.id),
      one("SELECT 1 x FROM api_keys WHERE user_id = ? AND revoked_at IS NULL AND name LIKE '%laude%'", me.id),
      one('SELECT COUNT(*) n FROM accounts WHERE enabled = 1'),
      one('SELECT COUNT(*) n FROM posts'),
      one("SELECT 1 x FROM chat_messages WHERE user_id = ? LIMIT 1", me.id),
    ]);
    out.setup = [
      ['photo', 'Add your photo', '#profile', !!me.avatar],
      ['2step', 'Turn on 2-step sign-in', '#account', !!me.totp_enabled],
      ['team', 'Invite a teammate', '#people', team.n > 0, 'admin'],
      ['contact', 'Add your first contact', '#contacts', (out.counts.contacts || 0) > 0],
      ['booking', 'Set your booking hours', '#calendar', !!booking.x, 'admin'],
      ['recipe', 'Switch on an automation', '#automations', autos.n > 0, 'admin'],
      ['claude', 'Connect Claude', '#integrations', !!claude.x],
      ['post', 'Schedule your first post', '#social', posts.n > 0 && accts.n > 0],
      ['chat', 'Say hello in #team', '#chat/team', !!firstMsg.x],
    ].filter(x => !x[4] || can(me, x[4])).map(x => ({ key: x[0], label: x[1], link: x[2], done: x[3] }));
    out.feed = (await all(`SELECT * FROM (
        SELECT 'chat' kind, m.created_at at, u.name who, u.avatar avatar, m.body text, m.channel_id ref FROM chat_messages m JOIN users u ON u.id = m.user_id WHERE m.channel_id = 'team' OR m.channel_id LIKE 'cl_%'
        UNION ALL SELECT 'lead', c.created_at, c.name, NULL, COALESCE(c.source, 'New lead'), c.id FROM crm_contacts c WHERE c.private = 0
        UNION ALL SELECT 'post', p.scheduled_at, p.created_by, NULL, p.body, p.id FROM posts p WHERE p.status IN ('scheduled','review') AND p.scheduled_at >= ?
        UNION ALL SELECT 'va', c.created_at, c.name, NULL, c.headline, c.slug FROM candidates c WHERE c.status = 'approved'
      ) ORDER BY at DESC LIMIT 8`, dayStart)).map(f => ({ ...f, text: String(f.text || '').slice(0, 140) }));
  }
  if (can(me, 'admin')) {
    out.people = await all('SELECT role, status, COUNT(*) n FROM users GROUP BY role, status');
    out.pending_vas = (await one("SELECT COUNT(*) n FROM candidates WHERE status = 'pending' OR (status = 'approved' AND verified = 0)")).n;
    out.hours_week = (await one('SELECT COALESCE(SUM(minutes),0) m FROM timesheets WHERE day >= ?', weekAgo.slice(0, 10))).m;
  }
  if (me.role === 'super_admin') {
    out.audit = await all('SELECT actor, action, detail, created_at FROM audit ORDER BY id DESC LIMIT 8');
    out.sessions = (await one('SELECT COUNT(*) n FROM sessions WHERE expires_at > ?', Date.now())).n;
    out.failed_logins = (await one("SELECT COUNT(*) n FROM audit WHERE action = 'auth.login_failed' AND created_at > ?", weekAgo)).n;
  }
  if (me.role === 'va') {
    out.profile = me.candidate_id ? await one('SELECT name, slug, headline, status, photo_id, review_note FROM candidates WHERE id = ?', me.candidate_id) : null;
    out.clients = await all('SELECT c.id, c.name, c.company FROM va_assignments a JOIN crm_contacts c ON c.id = a.contact_id WHERE a.va_id = ? ORDER BY c.name', me.id);
    out.my_tasks = await all("SELECT t.id, t.title, t.due, t.status, c.name contact_name FROM crm_tasks t LEFT JOIN crm_contacts c ON c.id = t.contact_id WHERE t.assignee_id = ? AND t.status != 'done' ORDER BY t.due IS NULL, t.due LIMIT 12", me.id);
    const monday = new Date(); monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    out.week_minutes = (await one('SELECT COALESCE(SUM(minutes),0) m FROM timesheets WHERE va_id = ? AND day >= ?', me.id, monday.toISOString().slice(0, 10))).m;
    out.days = await all('SELECT day, SUM(minutes) m FROM timesheets WHERE va_id = ? AND day >= ? GROUP BY day', me.id, new Date(Date.now() - 13 * 86400_000).toISOString().slice(0, 10));
  }
  if (me.role === 'client' || me.role === 'member') {
    const cid = me.contact_id;
    out.company = cid ? await one('SELECT name, company, stage, kind FROM crm_contacts WHERE id = ?', cid) : null;
    out.requests = cid ? await all('SELECT id, title, status, created_at, updated_at FROM crm_requests WHERE contact_id = ? AND user_id IS NOT NULL ORDER BY created_at DESC LIMIT 6', cid) : [];
    out.tasks = cid ? await all("SELECT title, due, status FROM crm_tasks WHERE contact_id = ? AND client_visible = 1 ORDER BY status = 'done', due IS NULL, due LIMIT 10", cid) : [];
    out.team = cid ? await all("SELECT u.name, u.title, c.headline, c.slug, c.photo_id FROM va_assignments a JOIN users u ON u.id = a.va_id LEFT JOIN candidates c ON c.id = u.candidate_id AND c.status = 'approved' WHERE a.contact_id = ?", cid) : [];
    out.team = out.team.map(t => ({ name: t.name, title: t.title || t.headline || 'Virtual assistant', slug: t.slug || null, photo: t.photo_id ? 'https://desk.delegance.app/public/media/' + t.photo_id + '.png' : null }));
    out.unread = cid ? (await one("SELECT COUNT(*) n FROM crm_notes WHERE contact_id = ? AND visibility = 'client' AND author_id != ? AND created_at > ?", cid, me.id, me.last_login || '1970')).n : 0;
    out.hours_month = cid ? (await one('SELECT COALESCE(SUM(minutes),0) m FROM timesheets WHERE contact_id = ? AND day >= ?', cid, now().slice(0, 8) + '01')).m : 0;
  }
  return out;
}

function device(ua) {
  ua = String(ua || '');
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'Unknown device';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? br + ' on ' + os : os;
}

function linkedinUrl(v) {
  const u = clean(v, 300);
  if (!u) return null;
  const full = /^https?:\/\//i.test(u) ? u : 'https://' + u.replace(/^\/+/, '');
  return /^https:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\/(in|company)\/[^\s]+$/i.test(full.replace(/^http:/i, 'https:')) ? full.replace(/^http:/i, 'https:') : null;
}
