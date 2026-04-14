// Cloudflare Worker — serves static assets + click tracking API
// Analytics Engine dataset "button_clicks" must be enabled in Cloudflare dashboard

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // POST /api/click — log button click to Analytics Engine
    if (url.pathname === '/api/click' && request.method === 'POST') {
      try {
        const { button } = await request.json();
        if (button && typeof button === 'string' && button.length < 100) {
          env.CLICKS.writeDataPoint({
            blobs: [button],
            indexes: [button],
          });
        }
      } catch {
        // Silently ignore malformed requests
      }
      return new Response('ok', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // Everything else — serve static assets
    return env.ASSETS.fetch(request);
  },
};
