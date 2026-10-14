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

const BASE_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
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
  await env.DB.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, ua) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(t), user.id, now(), Date.now() + SESSION_DAYS * 86400_000, clean(req.headers.get('User-Agent'), 160)).run();
  await env.DB.prepare('UPDATE users SET last_login = ?, failed = 0, locked_until = NULL WHERE id = ?').bind(now(), user.id).run();
  return `${COOKIE}=${t}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}
export const clearCookie = `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
export async function endSession(env, req) { const t = cookieOf(req); if (t) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(t)).run(); }
export async function currentUser(env, req) {
  const t = cookieOf(req);
  if (!t) return null;
  const id = await sha256(t);
  const s = await env.DB.prepare('SELECT s.id sid, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?').bind(id).first();
  if (!s || s.expires_at < Date.now() || s.status !== 'active') { if (s) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run(); return null; }
  if (s.expires_at - Date.now() < 7 * 86400_000) await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').bind(Date.now() + SESSION_DAYS * 86400_000, id).run();
  return s;
}
export const can = (user, role) => !!user && (ROLES[user.role] || 0) >= ROLES[role];
export const publicUser = u => ({ id: u.id, email: u.email, name: u.name, role: u.role, role_name: ROLE_NAMES[u.role], title: u.title || null, status: u.status, candidate_id: u.candidate_id || null, contact_id: u.contact_id || null, last_login: u.last_login || null, created_at: u.created_at });

export async function makeLink(env, userId, kind, hours, by) {
  const t = token();
  await env.DB.prepare('INSERT INTO auth_tokens (id, user_id, kind, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await sha256(t), userId, kind, Date.now() + hours * 3600_000, by || null, now()).run();
  return `https://delegance.app/login#${kind}=${t}`;
}
