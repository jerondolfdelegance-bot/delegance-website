// delegance.app/updates.xml: RSS feed of everything new on Delegance.
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare('SELECT id, version, title, body, released_at FROM product_updates ORDER BY released_at DESC, id DESC LIMIT 50').all();
  const x = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const items = results.map(u => `  <item><title>${x((u.version ? u.version + ' · ' : '') + u.title)}</title><link>https://delegance.app/whats-new#${x(u.id)}</link><guid isPermaLink="false">delegance-${x(u.id)}</guid><pubDate>${new Date(u.released_at + 'T00:00:00Z').toUTCString()}</pubDate><description>${x(u.body)}</description></item>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>What's new at Delegance</title><link>https://delegance.app/whats-new</link><description>New features and improvements on Delegance.</description><language>en</language>\n${items}\n</channel></rss>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=900', 'X-Content-Type-Options': 'nosniff' } });
}
