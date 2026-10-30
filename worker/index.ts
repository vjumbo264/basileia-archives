/**
 * Cloudflare Worker for Basileia Archives
 * - Serves Static Assets (Vite React Build)
 * - Contingency Range-capable audio proxy (/api/audio-proxy?url=...) for strict clients
 * - Zero secrets, zero password gate, completely open public archive
 */

export interface Env {
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Contingency audio proxy route: forwards Range to GitHub release asset and sets Content-Type: audio/mp4
    if (url.pathname === '/api/audio-proxy') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl || !targetUrl.startsWith('https://github.com/vjumbo264/basileia-archives/releases/download/')) {
        return new Response('Invalid or missing audio URL', { status: 400 });
      }

      const clientRange = request.headers.get('Range');
      const fetchHeaders: HeadersInit = {
        'User-Agent': 'BasileiaArchives-Proxy/2.0'
      };
      if (clientRange) {
        fetchHeaders['Range'] = clientRange;
      }

      try {
        const upstream = await fetch(targetUrl, {
          headers: fetchHeaders,
          redirect: 'follow'
        });

        const respHeaders = new Headers(upstream.headers);
        respHeaders.set('Content-Type', 'audio/mp4');
        respHeaders.set('Accept-Ranges', 'bytes');
        respHeaders.set('Access-Control-Allow-Origin', '*');

        return new Response(upstream.body, {
          status: upstream.status,
          headers: respHeaders
        });
      } catch (err: any) {
        return new Response(`Streaming error: ${err.message}`, { status: 502 });
      }
    }

    // Serve static assets
    if (env.ASSETS) {
      return await env.ASSETS.fetch(request);
    }

    return new Response('Basileia Archives Worker Active', { status: 200 });
  }
};
