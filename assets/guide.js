/* Guides: reading progress bar, table of contents from the headings, copy link and print. */
(function () {
  var prose = document.querySelector('.prose'); if (!prose) return;
  var bar = document.createElement('div'); bar.className = 'gprog'; bar.setAttribute('aria-hidden', 'true'); document.body.appendChild(bar);
  var art = document.querySelector('.garticle') || prose;
  function prog() { var r = art.getBoundingClientRect(), h = r.height - innerHeight; bar.style.width = Math.max(0, Math.min(100, h > 0 ? -r.top / h * 100 : 100)) + '%'; }
  addEventListener('scroll', prog, { passive: true }); prog();
  var hs = [].slice.call(prose.querySelectorAll('h2'));
  if (hs.length >= 3) {
    var toc = document.createElement('nav'); toc.className = 'gtoc'; toc.setAttribute('aria-label', 'In this guide');
    toc.innerHTML = '<b>In this guide</b><ol>' + hs.map(function (h, i) { var id = h.id || (h.id = 's' + (i + 1) + '-' + h.textContent.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)); return '<li><a href="#' + id + '">' + h.textContent.replace(/[<>&]/g, '') + '</a></li>'; }).join('') + '</ol>';
    var lead = prose.querySelector('.lead'); prose.insertBefore(toc, lead ? lead.nextSibling : prose.firstChild);
  }
  var sh = document.createElement('div'); sh.className = 'gshare';
  sh.innerHTML = '<button type="button" data-a="copy">Copy link</button><button type="button" data-a="share">Share</button><button type="button" data-a="print">Print or save as PDF</button>';
  prose.appendChild(sh);
  sh.addEventListener('click', function (e) {
    var a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'print') return print();
    if (a.dataset.a === 'share' && navigator.share) return navigator.share({ title: document.title, url: location.href }).catch(function () {});
    navigator.clipboard.writeText(location.href).then(function () { a.textContent = 'Link copied'; setTimeout(function () { a.textContent = 'Copy link'; }, 2000); });
  });
})();
