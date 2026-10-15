/* Signed in? Swap "Sign in" links for your name and photo, linking to your dashboard. */
(function () {
  fetch('/api/auth/me', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (!d || !d.user) return;
    window.DLG_SIGNED_IN = true;
    if (d.user.theme && window.DLGTheme && d.user.theme !== DLGTheme.get()) DLGTheme.set(d.user.theme, false);
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

/* Your own VA profile: show "This is you" with a one-click edit on the profile page and in the VA list. */
(function () {
  function editLink(btn) {
    btn.disabled = true; var t = btn.textContent; btn.textContent = 'Opening…';
    fetch('/api/auth/va-profile/edit-link', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Could not open the editor.'); return j; }); })
      .then(function (j) { location.href = j.url; })
      .catch(function (e) { btn.disabled = false; btn.textContent = t; alert(e.message); });
  }
  fetch('/api/auth/me', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    var va = d && d.user && d.user.va; if (!va || !va.slug) return;
    var mine = '/va/' + encodeURIComponent(va.slug);
    if (location.pathname === mine || location.pathname === mine + '/') {
      var bar = document.createElement('div'); bar.className = 'own-bar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Your profile');
      bar.innerHTML = '<span><b>This is your profile.</b> ' + (va.status === 'approved' ? 'Clients see exactly this page.' : 'It is waiting for review, so clients cannot see it yet.') + '</span><button type="button" class="own-edit">Edit my profile</button>';
      var main = document.querySelector('main') || document.body; main.parentNode.insertBefore(bar, main);
      bar.querySelector('button').onclick = function () { editLink(this); };
    }
    var mark = function () {
      document.querySelectorAll('a.vcard[href="' + mine + '"]').forEach(function (a) {
        if (a.querySelector('.own-tag')) return;
        var tag = document.createElement('span'); tag.className = 'own-tag'; tag.textContent = 'You'; a.appendChild(tag);
      });
    };
    mark(); new MutationObserver(mark).observe(document.body, { childList: true, subtree: true });
  }).catch(function () {});
})();
