// delegance.app/va/<slug>: serves the profile page with link-preview tags filled in,
// so a VA's link looks right when pasted into Facebook, LinkedIn, Messenger or a job site.
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export async function onRequestGet({ params, request, env }) {
  const slug = String(params.slug || '').toLowerCase();
  const page = await env.ASSETS.fetch(new URL('/candidate', request.url));
  let html = await page.text();
  if (/^[a-z0-9-]{3,60}$/.test(slug)) {
    try {
      const r = await fetch('https://desk.delegance.app/public/candidates/' + slug, { cf: { cacheTtl: 120 } });
      if (r.ok) {
        const c = await r.json();
        const title = `${c.name} · ${c.headline} · Delegance`;
        const desc = `${c.headline}. ${[c.availability, c.location, c.years ? c.years + ' years experience' : ''].filter(Boolean).join(' · ')}. ${(c.skills || []).slice(0, 6).join(', ')}.`;
        const url = 'https://delegance.app/va/' + c.slug;
        html = html
          .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
          .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">\n<link rel="canonical" href="${url}">`)
          .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">\n<meta property="og:url" content="${url}">`)
          .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(desc)}">`)
          .replace('</head>', `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Person', name: c.name, jobTitle: c.headline, description: c.about, knowsAbout: [...(c.skills || []), ...(c.tools || [])], url, worksFor: { '@type': 'Organization', name: 'Delegance', url: 'https://delegance.app/' } }).replace(/</g, '\\u003c')}</script>\n</head>`);
      } else if (r.status === 404) {
        html = html.replace('<meta name="theme-color"', '<meta name="robots" content="noindex">\n<meta name="theme-color"');
      }
    } catch (e) {}
  }
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=120',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://desk.delegance.app; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://desk.delegance.app; connect-src 'self' https://cloudflareinsights.com https://desk.delegance.app; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" } });
}
