// delegance.app/sitemap.xml: the main pages plus every live VA profile, so search engines find them.
const PAGES = ['/', '/candidates', '/apply', '/book', '/guides', '/whats-new', '/status', '/privacy', '/terms'];
export async function onRequestGet({ env, request }) {
  const base = 'https://delegance.app', guides = new Set();
  let urls = PAGES.map(p => ({ loc: base + p }));
  try {
    const g = await env.ASSETS.fetch(new URL('/sitemap.xml', request.url));
    for (const m of (await g.text()).matchAll(/<loc>https:\/\/delegance\.app(\/guides\/[a-z0-9-]+)<\/loc>/g)) guides.add(m[1]);
  } catch (e) {}
  urls = urls.concat([...guides].map(p => ({ loc: base + p })));
  try {
    const r = await fetch('https://desk.delegance.app/public/candidates', { cf: { cacheTtl: 600 } });
    if (r.ok) for (const c of await r.json()) urls.push({ loc: base + '/va/' + c.slug, lastmod: String(c.updated_at || '').slice(0, 10) });
  } catch (e) {}
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${esc(u.lastmod)}</lastmod>` : ''}</url>`).join('\n') + '\n</urlset>\n';
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=900', 'X-Content-Type-Options': 'nosniff' } });
}
