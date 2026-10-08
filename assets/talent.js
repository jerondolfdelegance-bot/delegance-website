/* Delegance talent pages: shared helpers */
(function () {
  var API = 'https://desk.delegance.app/public/';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  async function api(path, opts) {
    opts = opts || {};
    var r = await fetch(API + path, { method: opts.method || (opts.body !== undefined || opts.raw ? 'POST' : 'GET'), headers: opts.raw ? { 'Content-Type': opts.type } : opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: opts.raw ? opts.raw : opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(d.error || 'Something went wrong. Please try again.');
    return d;
  }
  function toast(msg, err) {
    var t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; t.setAttribute('role', 'status');
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, err ? 6000 : 3500);
  }
  var port = function (src, cls, mark) { return '<div class="port ' + (cls || '') + '">' + (mark ? '<span class="mark">DELEGANCE</span>' : '') + (src ? '<img src="' + esc(src) + '" alt="" loading="lazy" decoding="async">' : '') + '</div>'; };
  var safe = function (u) { return /^https:\/\//i.test(String(u || '')) ? u : '#'; };
  var I = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l5 5 9-10"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 20l18-8L3 4l2 7 9 1-9 1z"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    brief: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 12h18"/></svg>',
  };
  window.T = { API: API, api: api, esc: esc, toast: toast, port: port, safe: safe, I: I };
})();
