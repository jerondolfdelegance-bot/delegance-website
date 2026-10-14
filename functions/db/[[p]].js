// Keep repo-only files (migrations) off the public site.
export const onRequest = () => new Response('Not found', { status: 404 });
