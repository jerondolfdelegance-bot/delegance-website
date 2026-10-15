/* Light / dark switch: Auto follows the device. Choice is saved on this device, and on your account when signed in. */
(function () {
  'use strict';
  var KEY = 'dlg-theme', root = document.documentElement, mq = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null;
  var ICON = {
    auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>'
  };
  var NAMES = { auto: 'Match my device', light: 'Light', dark: 'Dark' };
  function get() { try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; } }
  function apply(pref) {
    var mode = pref === 'auto' ? (mq && mq.matches ? 'light' : 'dark') : pref;
    root.dataset.theme = mode; root.dataset.themePref = pref;
    var mc = document.querySelector('meta[name=theme-color]'); if (mc) mc.content = mode === 'light' ? '#f6f2ea' : '#0a0a0b';
    document.querySelectorAll('.thm-btn').forEach(function (b) { b.innerHTML = ICON[mode]; b.setAttribute('aria-label', 'Theme: ' + NAMES[pref] + '. Change theme'); });
    document.querySelectorAll('.thm-menu button').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.t === pref)); });
    document.dispatchEvent(new CustomEvent('dlg-theme', { detail: mode }));
  }
  function set(pref, sync) {
    try { localStorage.setItem(KEY, pref); } catch (e) {}
    apply(pref);
    if (sync !== false && window.DLG_SIGNED_IN) fetch('/api/auth/prefs', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: pref }) }).catch(function () {});
  }
  function mount(slot) {
    if (slot.dataset.ready) return; slot.dataset.ready = '1';
    slot.classList.add('thm');
    slot.innerHTML = '<button type="button" class="thm-btn" aria-haspopup="menu" aria-expanded="false"></button><div class="thm-menu" role="menu" hidden>' + ['auto', 'light', 'dark'].map(function (k) { return '<button type="button" role="menuitemradio" data-t="' + k + '">' + ICON[k] + '<span>' + NAMES[k] + '</span></button>'; }).join('') + '</div>';
    var btn = slot.querySelector('.thm-btn'), menu = slot.querySelector('.thm-menu');
    var close = function () { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.onclick = function (e) { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) menu.querySelector('[aria-checked=true]').focus(); };
    menu.onclick = function (e) { var b = e.target.closest('[data-t]'); if (!b) return; set(b.dataset.t); close(); btn.focus(); };
    document.addEventListener('click', function (e) { if (!slot.contains(e.target)) close(); });
    slot.addEventListener('keydown', function (e) { if (e.key === 'Escape') { close(); btn.focus(); } });
    apply(get());
  }
  window.DLGTheme = { set: set, get: get, mount: mount, scan: function () { document.querySelectorAll('[data-theme-toggle]').forEach(mount); } };
  if (mq) (mq.addEventListener ? mq.addEventListener('change', function () { if (get() === 'auto') apply('auto'); }) : mq.addListener(function () { if (get() === 'auto') apply('auto'); }));
  function boot() {
    var slots = document.querySelectorAll('[data-theme-toggle]');
    if (!slots.length && !document.body.dataset.noThemeFloat) { var f = document.createElement('div'); f.className = 'thm-float'; f.setAttribute('data-theme-toggle', ''); document.body.appendChild(f); slots = [f]; }
    slots.forEach(mount);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
