/* Signed in? Swap "Sign in" links for your name and photo, linking to your dashboard. */
(function () {
  fetch('/api/auth/me', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (!d || !d.user) return;
    var u = d.user, first = String(u.name || '').split(' ')[0];
    var ini = String(u.name || '?').split(/\s+/).map(function (x) { return x[0]; }).slice(0, 2).join('').toUpperCase();
    document.querySelectorAll('a[href="/login"]').forEach(function (a) {
      a.href = '/dashboard';
      if (/create/i.test(a.textContent)) { a.textContent = 'Open my dashboard'; return; }
      a.textContent = '';
      var av = u.avatar ? document.createElement('img') : document.createElement('span');
      if (u.avatar) { av.src = u.avatar; av.alt = ''; } else av.textContent = ini;
      av.setAttribute('style', 'display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:8px;font:600 10px Montserrat,sans-serif;background:linear-gradient(135deg,#e2c27a,#a8873e);color:#0a0a0b');
      a.appendChild(av); a.appendChild(document.createTextNode(first || 'My dashboard'));
      a.setAttribute('aria-label', 'Open your dashboard, signed in as ' + (u.name || ''));
    });
  }).catch(function () {});
})();
