/* Delegance motion kit: small, dependency-free effects inspired by the BrewedOps Motion Library
   (free licence, brewedops.cloud/motionlibrary). Everything respects prefers-reduced-motion. */
(function () {
  'use strict';
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = matchMedia('(pointer: fine)').matches;

  // Count up: <b data-count>US$8,490</b> animates the number inside the text once it is on screen.
  function countUp(el) {
    if (el.dataset.counted) return;
    el.dataset.counted = '1';
    var text = el.textContent, m = text.match(/-?\d[\d,]*(\.\d+)?/);
    if (!m || still) return;
    var target = parseFloat(m[0].replace(/,/g, '')), dec = (m[1] || '').length - (m[1] ? 1 : 0);
    if (!isFinite(target) || target === 0) return;
    var pre = text.slice(0, m.index), post = text.slice(m.index + m[0].length), dur = Math.min(1600, 700 + Math.log10(Math.abs(target) + 1) * 220), t0 = 0;
    var fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    el.setAttribute('aria-label', text);
    el.style.fontVariantNumeric = 'tabular-nums';
    function step(t) { t0 = t0 || t; var p = Math.min(1, (t - t0) / dur), k = 1 - Math.pow(1 - p, 4); el.textContent = pre + fmt.format(target * k) + post; if (p < 1) requestAnimationFrame(step); else el.textContent = text; }
    requestAnimationFrame(step);
  }

  // Word flip: <em data-words="elegantly|reliably|securely">elegantly.</em> rolls through the words, ending where it started.
  function words(el) {
    if (el.dataset.wf || still) return;
    el.dataset.wf = '1';
    var list = el.dataset.words.split('|'), end = el.textContent, i = 0;
    el.setAttribute('aria-label', end);
    var box = document.createElement('span'); box.className = 'wf'; box.setAttribute('aria-hidden', 'true');
    el.textContent = ''; el.appendChild(box);
    var cur = document.createElement('span'); cur.textContent = end; box.appendChild(cur);
    var timer = setInterval(function () {
      if (document.hidden) return;
      i = (i + 1) % list.length;
      var nx = document.createElement('span'); nx.className = 'in'; nx.textContent = list[i] + (/[.!]$/.test(end) ? end.slice(-1) : '');
      cur.className = 'out'; box.appendChild(nx);
      var old = cur; cur = nx; setTimeout(function () { old.remove(); nx.className = ''; }, 520);
    }, 2600);
    el._stop = function () { clearInterval(timer); };
  }

  // Magnetic: buttons lean toward the cursor a little (mouse only).
  function magnetic(el) {
    if (!fine || still || el.dataset.mag) return;
    el.dataset.mag = '1';
    el.addEventListener('pointermove', function (e) { var r = el.getBoundingClientRect(); el.style.transform = 'translate(' + ((e.clientX - r.left - r.width / 2) * .18).toFixed(1) + 'px,' + ((e.clientY - r.top - r.height / 2) * .28).toFixed(1) + 'px)'; });
    el.addEventListener('pointerleave', function () { el.style.transform = ''; });
  }

  // 6-box code input that writes into the real (kept) input. Paste and backspace work as expected.
  function otp(input, onFull) {
    if (input.dataset.otp) return;
    input.dataset.otp = '1';
    var wrap = document.createElement('div'); wrap.className = 'otp'; wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', '6-digit code');
    var boxes = [];
    for (var i = 0; i < 6; i++) { var b = document.createElement('input'); b.type = 'text'; b.inputMode = 'numeric'; b.maxLength = 1; b.autocomplete = i ? 'off' : 'one-time-code'; b.setAttribute('aria-label', 'Digit ' + (i + 1)); boxes.push(b); wrap.appendChild(b); }
    input.parentNode.insertBefore(wrap, input);
    input.classList.add('otp-src'); input.tabIndex = -1; input.setAttribute('aria-hidden', 'true');
    function sync() { input.value = boxes.map(function (b) { return b.value; }).join(''); wrap.classList.toggle('full', input.value.length === 6); if (input.value.length === 6 && onFull) onFull(); }
    function fill(from, digits) { digits = digits.replace(/\D/g, '').slice(0, 6 - from); for (var j = 0; j < digits.length; j++) boxes[from + j].value = digits[j]; var n = Math.min(5, from + digits.length); boxes[n].focus(); sync(); }
    boxes.forEach(function (b, idx) {
      b.addEventListener('input', function () { var v = b.value.replace(/\D/g, ''); b.value = ''; if (v) fill(idx, v); else sync(); });
      b.addEventListener('keydown', function (e) { if (e.key === 'Backspace' && !b.value && idx) { boxes[idx - 1].value = ''; boxes[idx - 1].focus(); sync(); e.preventDefault(); } else if (e.key === 'ArrowLeft' && idx) boxes[idx - 1].focus(); else if (e.key === 'ArrowRight' && idx < 5) boxes[idx + 1].focus(); });
      b.addEventListener('paste', function (e) { var t = (e.clipboardData || window.clipboardData).getData('text'); if (/\d/.test(t)) { e.preventDefault(); fill(idx, t); } });
      b.addEventListener('focus', function () { b.select(); });
    });
    return { focus: function () { boxes[0].focus(); }, clear: function () { boxes.forEach(function (b) { b.value = ''; }); sync(); boxes[0].focus(); }, el: wrap, shake: function () { wrap.classList.remove('shake'); void wrap.offsetWidth; wrap.classList.add('shake'); } };
  }

  // Password strength meter under a new-password field.
  function strength(input) {
    if (input.dataset.pm) return;
    input.dataset.pm = '1';
    var m = document.createElement('div'); m.className = 'pm'; m.innerHTML = '<div class="pm-bar"><i></i><i></i><i></i><i></i></div><span class="pm-t" aria-live="polite"></span>';
    (input.closest('.pw') || input).insertAdjacentElement('afterend', m);
    var labels = ['', 'Too short', 'Okay', 'Strong', 'Excellent'];
    input.addEventListener('input', function () {
      var v = input.value, s = 0;
      if (v.length) s = 1;
      if (v.length >= 10) s = 2;
      if (v.length >= 12 && /[a-z]/i.test(v) && (/\d/.test(v) || /\W|\s/.test(v))) s = 3;
      if (v.length >= 16 && /[a-z]/.test(v) && /[A-Z]/.test(v) && (/\d/.test(v) || /\W|\s/.test(v))) s = 4;
      if (/^(.)\1+$/.test(v) || /^(password|qwerty|1234)/i.test(v)) s = Math.min(s, 1);
      m.dataset.s = s; m.querySelector('.pm-t').textContent = labels[s];
    });
  }

  // Buttons: spinner while working, a tick on success.
  function busy(btn, state) {
    if (!btn) return;
    if (state === true) { btn.dataset.label = btn.dataset.label || btn.innerHTML; btn.disabled = true; btn.classList.add('is-busy'); btn.setAttribute('aria-busy', 'true'); }
    else if (state === 'done') { btn.classList.remove('is-busy'); btn.classList.add('is-done'); btn.removeAttribute('aria-busy'); }
    else { btn.disabled = false; btn.classList.remove('is-busy', 'is-done'); btn.removeAttribute('aria-busy'); }
  }

  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); countUp(e.target); } }); }, { threshold: .4 }) : null;
  function scan(root) {
    root = root || document;
    root.querySelectorAll('[data-count]').forEach(function (el) { if (io) io.observe(el); else countUp(el); });
    root.querySelectorAll('[data-words]').forEach(words);
    root.querySelectorAll('[data-magnetic]').forEach(magnetic);
    root.querySelectorAll('input[data-strength]').forEach(strength);
  }
  window.DLGMotion = { scan: scan, otp: otp, strength: strength, busy: busy, countUp: countUp };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { scan(); }); else scan();
})();
