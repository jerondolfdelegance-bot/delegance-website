// Shared helpers for the Delegance Accounts + CRM API.
export const ROLES = { member: 10, client: 20, va: 30, staff: 60, admin: 80, super_admin: 100 };
export const ROLE_NAMES = { member: 'Member', client: 'Client', va: 'Virtual assistant', staff: 'Staff', admin: 'Admin', super_admin: 'Super admin' };
export const STAGES = ['new', 'contacted', 'call', 'proposal', 'won', 'lost'];
const SESSION_DAYS = 14;
export const COOKIE = '__Host-dlg';

export const now = () => new Date().toISOString();
export const uid = (p = '') => p + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
export const token = () => { const b = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' }[c])); };
const enc = new TextEncoder();
export async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? Uint8Array.from(atob(saltB64), c => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return { hash: b64(bits), salt: b64(salt) };
}
export function same(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  if (x.length !== y.length) return false;
  return crypto.subtle.timingSafeEqual ? crypto.subtle.timingSafeEqual(x, y) : x.every((v, i) => v === y[i]);
}
export function passwordProblem(pw, email) {
  pw = String(pw || '');
  if (pw.length < 10) return 'Use at least 10 characters for your password.';
  if (pw.length > 200) return 'That password is too long.';
  if (email && pw.toLowerCase().includes(String(email).split('@')[0].toLowerCase()) && String(email).split('@')[0].length > 3) return 'Your password should not contain your email name.';
  if (/^(.)\1+$/.test(pw) || /^(password|qwerty|1234)/i.test(pw)) return 'Please choose a less guessable password.';
  return null;
}

const BASE_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" };
export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, ...headers } });
export const bad = (error, status = 400) => json({ error }, status);
export const clean = (v, max = 200) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
export const cleanEmail = v => { const e = clean(v, 254).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : ''; };
export const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

export async function body(req) {
  if (!/application\/json/i.test(req.headers.get('Content-Type') || '')) return {};
  try { const b = await req.json(); return b && typeof b === 'object' ? b : {}; } catch { return {}; }
}

export async function limited(env, key, max, windowSec) {
  const t = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare('SELECT n, reset_at FROM rate WHERE k = ?').bind(key).first();
  if (!row || row.reset_at < t) { await env.DB.prepare('INSERT OR REPLACE INTO rate (k, n, reset_at) VALUES (?, 1, ?)').bind(key, t + windowSec).run(); return false; }
  if (row.n >= max) return true;
  await env.DB.prepare('UPDATE rate SET n = n + 1 WHERE k = ?').bind(key).run();
  return false;
}
export async function audit(env, actor, action, detail) {
  try { await env.DB.prepare('INSERT INTO audit (actor, action, detail, created_at) VALUES (?, ?, ?, ?)').bind(String(actor || 'system').slice(0, 120), action, detail ? String(detail).slice(0, 500) : null, now()).run(); } catch {}
}

const cookieOf = req => { const m = (req.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([A-Za-z0-9_-]{20,})')); return m ? m[1] : null; };
export async function startSession(env, req, user) {
  const t = token();
  const cf = req.cf || {}, place = [cf.city, cf.country].filter(Boolean).join(', ') || null;
  await env.DB.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, ua, place, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(await sha256(t), user.id, now(), Date.now() + SESSION_DAYS * 86400_000, clean(req.headers.get('User-Agent'), 160), place, now()).run();
  await env.DB.prepare('UPDATE users SET last_login = ?, failed = 0, locked_until = NULL WHERE id = ?').bind(now(), user.id).run();
  try { await newDeviceAlert(env, req, user, place); } catch (e) {}
  return `${COOKIE}=${t}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

// New-device alert: the first sign-in from a new browser, system or country gets a short email.
// The very first sign-in on an account just records the device quietly.
const uaLabel = ua => { ua = String(ua || ''); const b = (ua.match(/Edg|OPR|Chrome|Firefox|Safari/) || ['Browser'])[0].replace('Edg', 'Edge').replace('OPR', 'Opera'); const o = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'device'; return b + ' on ' + o; };
async function newDeviceAlert(env, req, user, place) {
  const label = uaLabel(req.headers.get('User-Agent')), cc = (req.cf && req.cf.country) || '?';
  const fp = await sha256(label + '|' + cc), t = now();
  const seen = await env.DB.prepare('SELECT 1 FROM known_devices WHERE user_id = ? AND fp = ?').bind(user.id, fp).first();
  if (seen) { await env.DB.prepare('UPDATE known_devices SET last_seen = ? WHERE user_id = ? AND fp = ?').bind(t, user.id, fp).run(); return; }
  const any = await env.DB.prepare('SELECT 1 FROM known_devices WHERE user_id = ? LIMIT 1').bind(user.id).first();
  await env.DB.prepare('INSERT INTO known_devices (user_id, fp, label, first_seen, last_seen) VALUES (?,?,?,?,?)').bind(user.id, fp, label + (place ? ' · ' + place : ''), t, t).run();
  if (!any) return;
  await audit(env, user.email, 'auth.new_device', label + ' · ' + (place || cc));
  await sendEmail(env, { to: user.email, subject: 'New sign-in to your Delegance account', intro: `Hi ${String(user.name || '').split(' ')[0]},\n\nYour Delegance account just signed in from ${label}${place ? ' in ' + place : ''}.\n\nIf this was you, there is nothing to do. If not, open Account settings, sign out of other devices and change your password right away.`, button: 'Review my account', link: 'https://delegance.app/dashboard#account' });
}
export const clearCookie = `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
export async function endSession(env, req) { const t = cookieOf(req); if (t) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(t)).run(); }
export async function currentUser(env, req) {
  const t = cookieOf(req);
  if (!t) return null;
  const id = await sha256(t);
  const s = await env.DB.prepare('SELECT s.id sid, s.expires_at, s.last_seen, s.place s_place, s.ua s_ua, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?').bind(id).first();
  if (!s || s.expires_at < Date.now() || s.status !== 'active') { if (s) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run(); return null; }
  // Session risk check on every request: a signed-in session that suddenly comes from another country or another
  // kind of browser is treated as stolen: it is ended and the person signs in again (with their 2-step code).
  const cc = (req.cf && req.cf.country) || null, was = s.s_place ? s.s_place.split(', ').pop() : null;
  const fam = ua => (String(ua || '').match(/Edg|OPR|Chrome|Firefox|Safari|okhttp|curl/) || ['?'])[0];
  if ((cc && was && /^[A-Z]{2}$/.test(was) && cc !== was && cc !== 'XX' && cc !== 'T1') || (s.s_ua && fam(s.s_ua) !== fam(req.headers.get('User-Agent')))) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
    await audit(env, s.email, 'session.risk_ended', `${was || '?'} -> ${cc || '?'} · ${fam(s.s_ua)} -> ${fam(req.headers.get('User-Agent'))}`);
    return null;
  }
  if (s.expires_at - Date.now() < 7 * 86400_000) await env.DB.prepare('UPDATE sessions SET expires_at = ?, last_seen = ? WHERE id = ?').bind(Date.now() + SESSION_DAYS * 86400_000, now(), id).run();
  else if (!s.last_seen || Date.now() - Date.parse(s.last_seen) > 600_000) await env.DB.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').bind(now(), id).run();
  return s;
}
export const can = (user, role) => !!user && (ROLES[user.role] || 0) >= ROLES[role];
export const publicUser = u => ({ id: u.id, email: u.email, name: u.name, role: u.role, role_name: ROLE_NAMES[u.role], title: u.title || null, status: u.status, candidate_id: u.candidate_id || null, contact_id: u.contact_id || null, last_login: u.last_login || null, created_at: u.created_at, mfa: !!u.totp_enabled, mfa_required: (ROLES[u.role] || 0) >= ROLES.staff, avatar: u.avatar || null, bio: u.bio || null, phone: u.phone || null, location: u.location || null, accent: u.accent || null, intent: u.intent || null, theme: u.theme || null });
export const ACCENTS = ['gold', 'silver', 'sapphire', 'emerald', 'rose', 'violet'];

export async function makeLink(env, userId, kind, hours, by) {
  const t = token();
  if (kind !== 'mfa') await env.DB.prepare('UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND kind = ? AND used_at IS NULL').bind(now(), userId, kind).run();
  await env.DB.prepare('INSERT INTO auth_tokens (id, user_id, kind, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await sha256(t), userId, kind, Date.now() + hours * 3600_000, by || null, now()).run();
  return kind === 'mfa' ? t : `https://delegance.app/login#${kind}=${t}`;
}

// ---------- 2-step sign-in (TOTP, RFC 6238) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function b32encode(bytes) { let bits = 0, val = 0, out = ''; for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) out += B32[(val << (5 - bits)) & 31]; return out; }
function b32decode(s) { s = String(s).replace(/=+$/, '').toUpperCase(); let bits = 0, val = 0; const out = []; for (const c of s) { const i = B32.indexOf(c); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return new Uint8Array(out); }
async function hotp(secretB32, counter) {
  const key = await crypto.subtle.importKey('raw', b32decode(secretB32), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new ArrayBuffer(8); new DataView(msg).setUint32(4, counter >>> 0); new DataView(msg).setUint32(0, Math.floor(counter / 2 ** 32));
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg)), o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}
// Returns the matched time step (to block replays) or 0.
export async function checkTotp(secretB32, code, lastStep) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return 0;
  const now = Math.floor(Date.now() / 30000);
  for (const s of [now, now - 1, now + 1]) if (s > (lastStep || 0) && same(await hotp(secretB32, s), code)) return s;
  return 0;
}
export const newTotpSecret = () => b32encode(crypto.getRandomValues(new Uint8Array(20)));
export const recoveryCodes = () => Array.from({ length: 8 }, () => { const b = crypto.getRandomValues(new Uint8Array(5)); return b32encode(b).toLowerCase().replace(/(.{4})/, '$1-'); });

// Secrets at rest (TOTP keys) are sealed with AES-GCM using the TOTP_KEY secret.
async function aesKey(env) {
  if (!env.TOTP_KEY) throw new Error('TOTP_KEY is not set');
  return crypto.subtle.importKey('raw', Uint8Array.from(atob(env.TOTP_KEY), c => c.charCodeAt(0)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(env, text) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(text)); return b64(iv) + '.' + b64(ct); }
export async function unseal(env, s) { const [iv, ct] = String(s).split('.').map(x => Uint8Array.from(atob(x), c => c.charCodeAt(0))); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aesKey(env), ct)); }
// Private contacts: only their owner sees them (anyone sees them again if the owner's account is off).
export const SEEN = a => `(${a}.id IS NULL OR ${a}.private = 0 OR ${a}.owner_id = ? OR ${a}.owner_id IS NULL OR ${a}.owner_id NOT IN (SELECT id FROM users WHERE status = 'active'))`;
export async function hiddenFrom(env, c, me) {
  if (!c || !c.private || !c.owner_id || c.owner_id === me.id) return false;
  return !!(await env.DB.prepare("SELECT 1 FROM users WHERE id = ? AND status = 'active'").bind(c.owner_id).first());
}
export const needsMfa = u => (ROLES[u.role] || 0) >= ROLES.staff;

// ---------- Email (Resend) ----------
export const mailReady = env => !!env.RESEND_API_KEY;
const escH = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function emailHtml({ title, intro, button, link, outro }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f6;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1a1a1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f6;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e6ea">
<tr><td style="background:#0a0a0b;padding:22px 28px;border-bottom:2px solid #e2c27a"><img src="https://delegance.app/brand/email-logo.png" alt="DELEGANCE" width="160" height="30" style="height:30px;width:160px;color:#ffffff;font:600 14px Arial;letter-spacing:4px"></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font:600 22px/1.3 Montserrat,Arial,sans-serif;color:#0a0a0b">${escH(title)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3a3a42;white-space:pre-line">${escH(intro)}</p>
${link ? `<p style="margin:0 0 20px"><a href="${escH(link)}" style="display:inline-block;background:#0a0a0b;color:#e2c27a;border:1px solid #e2c27a;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">${escH(button || 'Open')}</a></p>
<p style="margin:0 0 16px;font-size:12px;color:#7a7a84">Or paste this link into your browser:<br><span style="word-break:break-all">${escH(link)}</span></p>` : ''}
${outro ? `<p style="margin:0;font-size:13px;line-height:1.6;color:#7a7a84">${escH(outro)}</p>` : ''}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #eeeef1;font-size:12px;color:#9a9aa4">Delegance · An Elegant Delegation · <a href="https://delegance.app" style="color:#9a9aa4">delegance.app</a></td></tr>
</table></td></tr></table></body></html>`;
}
export async function sendEmail(env, { to, subject, title, intro, button, link, outro, replyTo }) {
  if (!mailReady(env) || !to) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM || 'Delegance <noreply@delegance.app>', to: [to], subject, reply_to: replyTo || env.TEAM_INBOX || 'admin@delegance.app',
        html: emailHtml({ title: title || subject, intro, button, link, outro }), text: [intro, link ? (button || 'Open') + ': ' + link : '', outro].filter(Boolean).join('\n\n') }),
    });
    if (!r.ok) console.error('email failed', r.status, (await r.text()).slice(0, 300));
    return r.ok;
  } catch (e) { console.error('email error', e && e.message); return false; }
}
export const teamInbox = env => env.TEAM_INBOX || 'admin@delegance.app';

// ---------- Cloudflare Turnstile (free bot check) ----------
export async function humanOk(env, tokenValue, ip) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!tokenValue) return false;
  try {
    const f = new FormData(); f.append('secret', env.TURNSTILE_SECRET); f.append('response', String(tokenValue)); if (ip) f.append('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: f });
    return !!(await r.json()).success;
  } catch { return false; }
}
