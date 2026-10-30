/**
 * Cloudflare Worker for PAV Podcast
 * Handles:
 * - Password Gate & Constant-time verification
 * - HMAC-SHA256 signed session cookies
 * - /api/episodes edge-cached catalog proxy
 * - /cover/:id/:size WebP image proxy & edge cache
 * - /audio/:id Range-capable streaming audio proxy (with GitHub asset 302 resolution)
 * - Single-Page Listening Application serving
 */

export interface Env {
  GITHUB_TOKEN_READ: string;
  SITE_PASSWORD: string;
  SESSION_SECRET: string;
  PASSWORD_ENABLED?: string;
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const REPO_OWNER = 'vjumbo264';
const REPO_NAME = 'pav-podcast';
const SESSION_COOKIE_NAME = 'pav_session';
const SESSION_MAX_AGE = 30 * 24 * 3600; // 30 days in seconds

// Constant-time string comparison to prevent timing attacks
function timingSafeEqualStr(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);
  if (aBuf.byteLength !== bBuf.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < aBuf.byteLength; i++) {
    diff |= aBuf[i] ^ bBuf[i];
  }
  return diff === 0;
}

// Sign timestamp using HMAC-SHA256
async function signSession(timestamp: number, secretHex: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretHex),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(String(timestamp)));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Verify session cookie signature and expiry
async function verifySession(cookieHeader: string | null, secretHex: string): Promise<boolean> {
  if (!cookieHeader || !secretHex) return false;
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([0-9]+)\\.([a-f0-9]+)`));
  if (!match) return false;
  const timestamp = parseInt(match[1], 10);
  const signatureHex = match[2];
  if (timestamp < Date.now()) return false;
  const expectedHex = await signSession(timestamp, secretHex);
  return timingSafeEqualStr(expectedHex, signatureHex);
}

// Login HTML Page
function renderLoginPage(errorMessage: string = '', returnUrl: string = '/'): string {
  return `<!doctype html>
<html lang="en" class="h-full bg-slate-950 text-slate-100">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <title>PAV Podcast — Archive Access</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; }
    body { background-color: #0b1120; color: #f8fafc; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
    .card { background: #1e293b; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 1.25rem; max-width: 24rem; width: 100%; padding: 2rem; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
    .badge { display: inline-flex; align-items: center; gap: 0.375rem; background: rgba(37, 99, 235, 0.15); color: #60a5fa; border: 1px solid rgba(37, 99, 235, 0.3); font-size: 0.75rem; font-weight: 600; padding: 0.25rem 0.625rem; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 1rem; }
    h1 { font-size: 1.75rem; font-weight: 700; letter-spacing: -0.025em; margin-bottom: 0.375rem; }
    p.subtitle { color: #94a3b8; font-size: 0.875rem; margin-bottom: 1.75rem; line-height: 1.4; }
    .error-box { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #fca5a5; font-size: 0.8125rem; padding: 0.75rem; border-radius: 0.625rem; margin-bottom: 1.25rem; }
    label { display: block; font-size: 0.8125rem; font-weight: 500; color: #cbd5e1; margin-bottom: 0.5rem; }
    .input-wrapper { position: relative; margin-bottom: 1.5rem; }
    input[type="password"], input[type="text"] { width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 0.75rem; color: #f8fafc; padding: 0.875rem 1rem; font-size: 1rem; outline: none; transition: border-color 0.2s, box-shadow 0.2s; }
    input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2); }
    .toggle-btn { position: absolute; right: 0.75rem; top: 50%; transform: translateY(-50%); background: none; border: none; color: #64748b; font-size: 0.75rem; cursor: pointer; padding: 0.25rem; font-weight: 600; }
    .submit-btn { width: 100%; background: #2563eb; color: #ffffff; border: none; border-radius: 0.75rem; padding: 0.875rem; font-size: 0.9375rem; font-weight: 600; cursor: pointer; transition: background 0.2s, transform 0.1s; }
    .submit-btn:hover { background: #1d4ed8; }
    .submit-btn:active { transform: scale(0.99); }
    .footer { text-align: center; margin-top: 1.5rem; font-size: 0.75rem; color: #64748b; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v20M17 5v14M7 9v6M22 8v8M2 11v2"/></svg>
      Private Sermon Archive
    </div>
    <h1>PAV Podcast</h1>
    <p class="subtitle">The Truth Simply Put — with PAV<br><span style="color:#64748b; font-size:0.75rem;">The Basileia Commission</span></p>

    ${errorMessage ? `<div class="error-box">${errorMessage}</div>` : ''}

    <form method="POST" action="/login">
      <input type="hidden" name="returnUrl" value="${returnUrl.replace(/"/g, '&quot;')}">
      <div>
        <label for="password">Access Password</label>
        <div class="input-wrapper">
          <input type="password" id="password" name="password" required autofocus placeholder="Enter access password" autocomplete="current-password">
          <button type="button" class="toggle-btn" onclick="togglePass()">SHOW</button>
        </div>
      </div>
      <button type="submit" class="submit-btn">Enter Archive</button>
    </form>
    <div class="footer">Protected archive for church members & listeners</div>
  </div>
  <script>
    function togglePass() {
      const p = document.getElementById('password');
      const b = event.target;
      if (p.type === 'password') {
        p.type = 'text';
        b.innerText = 'HIDE';
      } else {
        p.type = 'password';
        b.innerText = 'SHOW';
      }
    }
  </script>
</body>
</html>`;
}

// Fetch episodes.json with edge caching
async function getEpisodesCatalog(env: Env): Promise<any> {
  const cacheKey = new Request('https://cache-internal.pav-podcast/episodes.json');
  const cache = (caches as any).default;
  let cachedResponse = await cache.match(cacheKey);

  if (cachedResponse) {
    try {
      return await cachedResponse.json();
    } catch (e) {}
  }

  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/episodes.json`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'PAV-Podcast-Worker',
      'Authorization': `Bearer ${env.GITHUB_TOKEN_READ}`,
      'Accept': 'application/vnd.github.raw+json'
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch catalog from GitHub (${res.status})`);
  }

  const data: any = await res.json();
  const strippedCatalog = {
    show: data.show,
    generatedAt: data.generatedAt,
    totalEpisodes: data.totalEpisodes,
    episodes: (data.episodes || []).map((ep: any) => ({
      id: ep.id,
      number: ep.number,
      title: ep.title,
      pubDate: ep.pubDate,
      year: ep.year,
      description: ep.description,
      durationSeconds: ep.durationSeconds,
      hasAudio: ep.status === 'done' && !!ep.audio,
      audioBytes: ep.audio ? ep.audio.bytes : null,
      friendlyDownloadName: ep.friendlyDownloadName,
      cover: ep.cover,
      status: ep.status
    }))
  };

  const toCache = new Response(JSON.stringify(strippedCatalog), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, max-age=180'
    }
  });
  await cache.put(cacheKey, toCache.clone());

  return strippedCatalog;
}

// Main Worker fetch handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Check password gate requirement
    const isPasswordEnabled = env.PASSWORD_ENABLED !== 'false';
    const isAuthed = isPasswordEnabled ? await verifySession(request.headers.get('Cookie'), env.SESSION_SECRET) : true;

    // Route: /login
    if (pathname === '/login') {
      if (request.method === 'GET') {
        if (isAuthed) {
          return Response.redirect(`${url.origin}/`, 302);
        }
        return new Response(renderLoginPage('', url.searchParams.get('return') || '/'), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      if (request.method === 'POST') {
        let password = '';
        let returnUrl = '/';
        const contentType = request.headers.get('content-type') || '';

        if (contentType.includes('application/x-www-form-urlencoded')) {
          const bodyText = await request.text();
          const params = new URLSearchParams(bodyText);
          password = params.get('password') || '';
          returnUrl = params.get('returnUrl') || '/';
        } else if (contentType.includes('application/json')) {
          const json: any = await request.json();
          password = json.password || '';
          returnUrl = json.returnUrl || '/';
        }

        const isValid = timingSafeEqualStr(password, env.SITE_PASSWORD || 'REDACTED_SITE_PASSWORD');
        if (!isValid) {
          // Slow down brute-force attacks
          await new Promise(r => setTimeout(r, 1200));
          if (contentType.includes('application/json')) {
            return new Response(JSON.stringify({ error: 'Incorrect password' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          return new Response(renderLoginPage('Incorrect password. Please try again.', returnUrl), {
            status: 401,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }

        // Generate signed session cookie for 30 days
        const expiry = Date.now() + SESSION_MAX_AGE * 1000;
        const signature = await signSession(expiry, env.SESSION_SECRET);
        const cookieVal = `${SESSION_COOKIE_NAME}=${expiry}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;

        if (contentType.includes('application/json')) {
          return new Response(JSON.stringify({ success: true, redirect: returnUrl }), {
            headers: {
              'Content-Type': 'application/json',
              'Set-Cookie': cookieVal
            }
          });
        }

        return new Response(null, {
          status: 302,
          headers: {
            'Location': returnUrl.startsWith('/') ? returnUrl : '/',
            'Set-Cookie': cookieVal
          }
        });
      }
    }

    // Route: /logout
    if (pathname === '/logout') {
      const clearCookie = `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
      return new Response(null, {
        status: 302,
        headers: {
          'Location': '/login',
          'Set-Cookie': clearCookie
        }
      });
    }

    // Gate all remaining routes
    if (!isAuthed) {
      const accept = request.headers.get('Accept') || '';
      if (accept.includes('text/html') || request.method === 'GET' && !pathname.startsWith('/api') && !pathname.startsWith('/audio') && !pathname.startsWith('/cover')) {
        const redirectUrl = `${url.origin}/login?return=${encodeURIComponent(pathname + url.search)}`;
        return Response.redirect(redirectUrl, 302);
      }
      return new Response(JSON.stringify({ error: 'unauthorized', message: 'Authentication required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Route: /api/episodes
    if (pathname === '/api/episodes') {
      try {
        const catalog = await getEpisodesCatalog(env);
        return new Response(JSON.stringify(catalog), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'private, max-age=60'
          }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: 'catalog_error', message: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Route: /cover/:id/:size (size: thumb or large)
    if (pathname.startsWith('/cover/')) {
      const parts = pathname.replace('/cover/', '').split('/');
      const epId = parts[0];
      const size = parts[1] === 'large' ? 'large' : 'thumb';

      const cacheKey = new Request(request.url);
      const cache = (caches as any).default;
      let cached = await cache.match(cacheKey);
      if (cached) return cached;

      try {
        const rawRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/episodes.json`, {
          headers: {
            'User-Agent': 'PAV-Podcast-Worker',
            'Authorization': `Bearer ${env.GITHUB_TOKEN_READ}`,
            'Accept': 'application/vnd.github.raw+json'
          }
        });
        const state: any = await rawRes.json();
        const ep = (state.episodes || []).find((e: any) => e.id === epId || String(e.number) === epId);
        const sha256 = ep?.cover?.sha256;

        if (!sha256) {
          // Fall back to default show artwork
          return Response.redirect(state.show?.artwork || 'https://pbcdn1.podbean.com/imglogo/image-logo/3852959/TSP_DPjpg_4mnkqa.jpeg', 302);
        }

        const imgRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/assets/covers/${size}/${sha256}.webp`, {
          headers: {
            'User-Agent': 'PAV-Podcast-Worker',
            'Authorization': `Bearer ${env.GITHUB_TOKEN_READ}`,
            'Accept': 'application/vnd.github.raw+json'
          }
        });

        if (!imgRes.ok) {
          return Response.redirect(state.show?.artwork, 302);
        }

        const imgHeaders = new Headers(imgRes.headers);
        imgHeaders.set('Content-Type', 'image/webp');
        imgHeaders.set('Cache-Control', 'private, max-age=31536000, immutable');

        const imgResponse = new Response(imgRes.body, { status: 200, headers: imgHeaders });
        ctx.waitUntil(cache.put(cacheKey, imgResponse.clone()));
        return imgResponse;
      } catch (e: any) {
        return new Response('Cover not found', { status: 404 });
      }
    }

    // Route: /audio/:id (Range-capable streaming proxy)
    if (pathname.startsWith('/audio/')) {
      const epId = pathname.replace('/audio/', '').split('/')[0];
      const isDownload = url.searchParams.get('download') === '1';

      try {
        const rawRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/episodes.json`, {
          headers: {
            'User-Agent': 'PAV-Podcast-Worker',
            'Authorization': `Bearer ${env.GITHUB_TOKEN_READ}`,
            'Accept': 'application/vnd.github.raw+json'
          }
        });
        const state: any = await rawRes.json();
        const ep = (state.episodes || []).find((e: any) => e.id === epId || String(e.number) === epId);

        if (!ep || !ep.audio || !ep.audio.assetId) {
          return new Response('Audio asset not found or not yet processed', { status: 404 });
        }

        // Call GitHub asset endpoint with redirect: manual
        const assetUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/assets/${ep.audio.assetId}`;
        const ghRes = await fetch(assetUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'PAV-Podcast-Worker',
            'Authorization': `Bearer ${env.GITHUB_TOKEN_READ}`,
            'Accept': 'application/octet-stream'
          },
          redirect: 'manual'
        });

        const signedUrl = ghRes.headers.get('Location');
        if (!signedUrl || (ghRes.status !== 302 && ghRes.status !== 307)) {
          return new Response(`Unable to retrieve signed download URL (${ghRes.status})`, { status: 502 });
        }

        // Fetch upstream signed URL WITHOUT authorization header, forwarding Range
        const forwardHeaders: Record<string, string> = {};
        const range = request.headers.get('Range');
        if (range) {
          forwardHeaders['Range'] = range;
        }

        const upstream = await fetch(signedUrl, {
          method: request.method === 'HEAD' ? 'HEAD' : 'GET',
          headers: forwardHeaders
        });

        const respHeaders = new Headers();
        respHeaders.set('Content-Type', 'audio/mp4');
        respHeaders.set('Accept-Ranges', 'bytes');

        if (upstream.headers.has('Content-Range')) {
          respHeaders.set('Content-Range', upstream.headers.get('Content-Range')!);
        }
        if (upstream.headers.has('Content-Length')) {
          respHeaders.set('Content-Length', upstream.headers.get('Content-Length')!);
        }

        if (isDownload) {
          const downloadName = ep.friendlyDownloadName || `${ep.title}.m4a`;
          respHeaders.set('Content-Disposition', `attachment; filename="${downloadName.replace(/"/g, '')}"`);
        } else {
          respHeaders.set('Content-Disposition', 'inline');
        }

        return new Response(upstream.body, {
          status: upstream.status,
          headers: respHeaders
        });
      } catch (err: any) {
        return new Response(`Streaming proxy error: ${err.message}`, { status: 500 });
      }
    }

    // If static assets binding exists in Cloudflare Workers, try serving asset
    if (env.ASSETS) {
      const assetRes = await env.ASSETS.fetch(request);
      if (assetRes.status !== 404) {
        return assetRes;
      }
    }

    // Default: Fallback SPA entry point
    return new Response(renderSpaHtml(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
};

function renderSpaHtml(): string {
  return `<!doctype html>
<html lang="en" class="h-full bg-slate-950 text-slate-100">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>PAV Podcast</title>
  <meta name="description" content="Private Sermon Archive and Listening Platform for The Truth Simply Put with PAV">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/lucide@latest/dist/umd/lucide.min.js"></script>
  <style>
    :root {
      --bg: #0b1120;
      --card: #1e293b;
      --card-hover: #243248;
      --accent: #2563eb;
      --accent-hover: #1d4ed8;
      --text: #f8fafc;
      --muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; -webkit-tap-highlight-color: transparent; }
    body { background-color: var(--bg); color: var(--text); min-height: 100vh; padding-bottom: 7rem; }
    .header { position: sticky; top: 0; z-index: 40; background: rgba(11, 17, 32, 0.85); backdrop-filter: blur(12px); border-bottom: 1px solid rgba(255, 255, 255, 0.06); padding: 0.875rem 1.25rem; display: flex; align-items: center; justify-content: space-between; }
    .brand { display: flex; align-items: center; gap: 0.625rem; font-size: 1.25rem; font-weight: 800; letter-spacing: -0.025em; color: #fff; text-decoration: none; }
    .brand-pill { background: linear-gradient(135deg, #2563eb, #3b82f6); border-radius: 0.5rem; padding: 0.35rem; display: flex; align-items: center; justify-content: center; color: white; }
    .header-actions { display: flex; align-items: center; gap: 0.5rem; }
    .icon-btn { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 0.625rem; color: var(--muted); padding: 0.5rem; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .icon-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.1); }
    .container { max-width: 48rem; margin: 0 auto; padding: 1.25rem; }
    .search-bar { width: 100%; background: var(--card); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 0.875rem; color: #fff; padding: 0.875rem 1rem 0.875rem 2.75rem; font-size: 0.9375rem; outline: none; margin-bottom: 1.5rem; position: relative; }
    .search-wrapper { position: relative; margin-bottom: 1.5rem; }
    .search-icon { position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
    .featured-card { background: linear-gradient(135deg, #1e293b, #0f172a); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 1.25rem; padding: 1.5rem; margin-bottom: 2rem; position: relative; overflow: hidden; }
    .featured-badge { display: inline-flex; align-items: center; gap: 0.375rem; background: rgba(37, 99, 235, 0.2); color: #60a5fa; border: 1px solid rgba(37, 99, 235, 0.4); font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; padding: 0.2rem 0.5rem; border-radius: 9999px; margin-bottom: 0.75rem; }
    .featured-title { font-size: 1.25rem; font-weight: 700; line-height: 1.3; margin-bottom: 0.5rem; }
    .featured-sub { font-size: 0.8125rem; color: var(--muted); margin-bottom: 1.25rem; line-height: 1.5; }
    .primary-btn { display: inline-flex; align-items: center; gap: 0.5rem; background: var(--accent); color: white; border: none; border-radius: 0.75rem; padding: 0.75rem 1.25rem; font-size: 0.875rem; font-weight: 600; cursor: pointer; text-decoration: none; }
    .section-title { font-size: 1rem; font-weight: 700; letter-spacing: -0.01em; margin-bottom: 0.875rem; display: flex; align-items: center; justify-content: space-between; }
    .chips { display: flex; gap: 0.5rem; overflow-x: auto; padding-bottom: 0.5rem; margin-bottom: 1.75rem; scrollbar-width: none; }
    .chip { background: var(--card); border: 1px solid rgba(255, 255, 255, 0.08); color: var(--muted); padding: 0.4rem 0.875rem; border-radius: 9999px; font-size: 0.8125rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
    .chip.active { background: var(--accent); color: white; border-color: var(--accent); }
    .episode-list { display: flex; flex-direction: column; gap: 0.75rem; }
    .episode-item { background: var(--card); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 1rem; padding: 0.875rem; display: flex; align-items: center; gap: 0.875rem; cursor: pointer; transition: background 0.15s, border-color 0.15s; }
    .episode-item:hover { background: var(--card-hover); border-color: rgba(255, 255, 255, 0.12); }
    .ep-cover { width: 3.5rem; height: 3.5rem; border-radius: 0.625rem; object-fit: cover; background: #0f172a; flex-shrink: 0; }
    .ep-info { flex: 1; min-width: 0; }
    .ep-num { font-size: 0.6875rem; font-weight: 700; color: #60a5fa; text-transform: uppercase; margin-bottom: 0.15rem; }
    .ep-title { font-size: 0.9375rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 0.25rem; }
    .ep-meta { font-size: 0.75rem; color: var(--muted); display: flex; align-items: center; gap: 0.5rem; }
    .play-circle { width: 2.25rem; height: 2.25rem; border-radius: 9999px; background: rgba(255, 255, 255, 0.08); display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; }
    .bottom-player { position: fixed; bottom: 0; left: 0; right: 0; z-index: 50; background: rgba(15, 23, 42, 0.96); backdrop-filter: blur(16px); border-top: 1px solid rgba(255, 255, 255, 0.1); padding: 0.75rem 1.25rem; box-shadow: 0 -10px 25px rgba(0, 0, 0, 0.5); }
    .progress-bar { width: 100%; height: 4px; background: #334155; border-radius: 9999px; margin-bottom: 0.625rem; position: relative; cursor: pointer; }
    .progress-fill { height: 100%; background: var(--accent); border-radius: 9999px; width: 0%; }
    .player-row { display: flex; align-items: center; justify-content: space-between; max-width: 48rem; margin: 0 auto; }
    .player-left { display: flex; align-items: center; gap: 0.75rem; min-width: 0; flex: 1; }
    .player-thumb { width: 2.75rem; height: 2.75rem; border-radius: 0.5rem; object-fit: cover; }
    .player-title { font-size: 0.875rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .player-time { font-size: 0.6875rem; color: var(--muted); }
    .player-controls { display: flex; align-items: center; gap: 0.75rem; }
    .speed-btn { font-size: 0.75rem; font-weight: 700; background: rgba(255, 255, 255, 0.08); border: none; border-radius: 0.375rem; color: #cbd5e1; padding: 0.25rem 0.5rem; cursor: pointer; }
    .play-btn { width: 2.5rem; height: 2.5rem; border-radius: 9999px; background: white; color: black; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; }
  </style>
</head>
<body>
  <header class="header">
    <a href="/" class="brand">
      <div class="brand-pill">
        <i data-lucide="radio" style="width:1.25rem;height:1.25rem"></i>
      </div>
      PAV Podcast
    </a>
    <div class="header-actions">
      <a href="/logout" class="icon-btn" title="Lock Archive">
        <i data-lucide="log-out" style="width:1.125rem;height:1.125rem"></i>
      </a>
    </div>
  </header>

  <main class="container">
    <div class="search-wrapper">
      <i data-lucide="search" class="search-icon" style="width:1.125rem;height:1.125rem"></i>
      <input type="text" id="searchInput" class="search-bar" placeholder="Search sermons by title or topic...">
    </div>

    <section id="featuredSection"></section>

    <div class="section-title">
      <span>Browse Years</span>
      <span id="episodeCount" style="font-size:0.75rem; color:var(--muted); font-weight:500;">Loading catalog...</span>
    </div>

    <div class="chips" id="yearChips">
      <button class="chip active" onclick="filterYear('all')">All</button>
    </div>

    <div class="section-title">
      <span>All Messages</span>
      <button onclick="toggleOrder()" id="orderBtn" style="background:none; border:none; color:var(--accent); font-size:0.8125rem; font-weight:600; cursor:pointer;">Newest First</button>
    </div>

    <div class="episode-list" id="episodesList">
      <div style="text-align:center; padding:3rem; color:var(--muted);">Loading sermons...</div>
    </div>
  </main>

  <div class="bottom-player" id="playerBar" style="display:none;">
    <div class="progress-bar" id="progressBar" onclick="seek(event)">
      <div class="progress-fill" id="progressFill"></div>
    </div>
    <div class="player-row">
      <div class="player-left">
        <img id="playerCover" class="player-thumb" src="" alt="Cover">
        <div style="min-width:0;">
          <div class="player-title" id="playerTitle">Select a sermon</div>
          <div class="player-time" id="playerTime">0:00 / 0:00</div>
        </div>
      </div>
      <div class="player-controls">
        <button class="speed-btn" id="speedBtn" onclick="cycleSpeed()">1.0x</button>
        <button class="icon-btn" onclick="skip(-15)" title="Back 15s">
          <i data-lucide="rotate-ccw" style="width:1.125rem;height:1.125rem"></i>
        </button>
        <button class="play-btn" id="playBtn" onclick="togglePlay()">
          <i data-lucide="play" id="playIcon" style="width:1.25rem;height:1.25rem"></i>
        </button>
        <button class="icon-btn" onclick="skip(30)" title="Forward 30s">
          <i data-lucide="rotate-cw" style="width:1.125rem;height:1.125rem"></i>
        </button>
        <a id="downloadLink" class="icon-btn" download title="Download MP4/AAC">
          <i data-lucide="download" style="width:1.125rem;height:1.125rem"></i>
        </a>
      </div>
    </div>
  </div>

  <audio id="audioElement" preload="metadata"></audio>

  <script>
    let catalog = [];
    let currentEpisode = null;
    let selectedYear = 'all';
    let newestFirst = true;
    let speeds = [0.75, 1.0, 1.25, 1.5, 2.0];
    let currentSpeedIndex = 1;
    const audio = document.getElementById('audioElement');

    async function loadCatalog() {
      try {
        const res = await fetch('/api/episodes');
        const data = await res.json();
        catalog = data.episodes || [];
        document.getElementById('episodeCount').innerText = catalog.length + ' messages';

        // Render years
        const years = Array.from(new Set(catalog.map(e => e.year))).sort((a,b) => b - a);
        const chipsContainer = document.getElementById('yearChips');
        chipsContainer.innerHTML = '<button class="chip active" data-year="all" onclick="filterYear(\x27all\x27)">All</button>' +
          years.map(y => '<button class="chip" data-year="' + y + '" onclick="filterYear(' + y + ')">' + y + '</button>').join('');

        // Featured (latest done episode or newest)
        const doneEps = catalog.filter(e => e.hasAudio);
        const featured = doneEps.length > 0 ? doneEps[doneEps.length - 1] : catalog[catalog.length - 1];
        if (featured) {
          renderFeatured(featured);
        }

        renderEpisodes();
        lucide.createIcons();
      } catch (err) {
        document.getElementById('episodesList').innerHTML = '<div style="text-align:center; padding:3rem; color:#ef4444;">Failed to load sermons.</div>';
      }
    }

    function renderFeatured(ep) {
      const coverUrl = ep.cover?.sha256 ? '/cover/' + ep.id + '/large' : 'https://pbcdn1.podbean.com/imglogo/image-logo/3852959/TSP_DPjpg_4mnkqa.jpeg';
      document.getElementById('featuredSection').innerHTML = [
        '<div class="featured-card">',
        '  <div class="featured-badge"><i data-lucide="sparkles" style="width:0.75rem;height:0.75rem"></i> Latest Message</div>',
        '  <h2 class="featured-title">' + ep.title + '</h2>',
        '  <p class="featured-sub">' + (ep.description || '') + '</p>',
        '  <button class="primary-btn" onclick="playEpisode(\x27' + ep.id + '\x27)">',
        '    <i data-lucide="play" style="width:1rem;height:1rem"></i> ' + (ep.hasAudio ? 'Listen Now' : 'Pending Ingestion'),
        '  </button>',
        '</div>'
      ].join('');
    }

    function renderEpisodes() {
      let filtered = catalog.slice();
      if (selectedYear !== 'all') {
        filtered = filtered.filter(e => e.year === selectedYear);
      }
      const q = document.getElementById('searchInput').value.toLowerCase().trim();
      if (q) {
        filtered = filtered.filter(e => e.title.toLowerCase().includes(q) || (e.description && e.description.toLowerCase().includes(q)));
      }
      filtered.sort((a,b) => newestFirst ? b.number - a.number : a.number - b.number);

      const list = document.getElementById('episodesList');
      if (filtered.length === 0) {
        list.innerHTML = '<div style="text-align:center; padding:3rem; color:var(--muted);">No messages found matching search.</div>';
        return;
      }

      list.innerHTML = filtered.map(ep => {
        const cover = ep.cover?.sha256 ? '/cover/' + ep.id + '/thumb' : 'https://pbcdn1.podbean.com/imglogo/image-logo/3852959/TSP_DPjpg_4mnkqa.jpeg';
        const dateStr = new Date(ep.pubDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        const dur = Math.floor(ep.durationSeconds / 60) + ' min';
        return [
          '<div class="episode-item" onclick="playEpisode(\x27' + ep.id + '\x27)">',
          '  <img class="ep-cover" loading="lazy" width="56" height="56" src="' + cover + '" alt="Cover">',
          '  <div class="ep-info">',
          '    <div class="ep-num">#' + String(ep.number).padStart(4, '0') + ' · ' + ep.year + '</div>',
          '    <div class="ep-title">' + ep.title + '</div>',
          '    <div class="ep-meta"><span>' + dateStr + '</span> · <span>' + dur + '</span>' + (ep.hasAudio ? ' · <span style="color:#10b981;">64k AAC</span>' : ' · <span style="color:#f59e0b;">Queued</span>') + '</div>',
          '  </div>',
          '  <div class="play-circle"><i data-lucide="' + (ep.hasAudio ? 'play' : 'clock') + '" style="width:1rem;height:1rem"></i></div>',
          '</div>'
        ].join('');
      }).join('');
      lucide.createIcons();
    }

    function filterYear(y) {
      selectedYear = y;
      document.querySelectorAll('#yearChips .chip').forEach(c => {
        c.classList.toggle('active', c.getAttribute('data-year') === String(y));
      });
      renderEpisodes();
    }

    function toggleOrder() {
      newestFirst = !newestFirst;
      document.getElementById('orderBtn').innerText = newestFirst ? 'Newest First' : 'Oldest First';
      renderEpisodes();
    }

    document.getElementById('searchInput').addEventListener('input', renderEpisodes);

    function playEpisode(id) {
      const ep = catalog.find(e => e.id === id);
      if (!ep) return;
      currentEpisode = ep;

      document.getElementById('playerBar').style.display = 'block';
      document.getElementById('playerTitle').innerText = ep.title;
      document.getElementById('playerCover').src = ep.cover?.sha256 ? '/cover/' + ep.id + '/thumb' : 'https://pbcdn1.podbean.com/imglogo/image-logo/3852959/TSP_DPjpg_4mnkqa.jpeg';
      document.getElementById('downloadLink').href = '/audio/' + ep.id + '?download=1';

      if (!ep.hasAudio) {
        alert('This sermon is in the processing queue and will be converted shortly.');
        return;
      }

      audio.src = '/audio/' + ep.id;
      audio.playbackRate = speeds[currentSpeedIndex];

      // Restore position if available
      try {
        const saved = localStorage.getItem('pos_' + ep.id);
        if (saved) audio.currentTime = parseFloat(saved);
      } catch(e) {}

      audio.play();
      updatePlayBtn(true);

      // Media Session metadata
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: ep.title,
          artist: 'The Basileia Commission',
          album: 'The Truth Simply Put with PAV',
          artwork: [{ src: '/cover/' + ep.id + '/large', sizes: '800x800', type: 'image/webp' }]
        });
      }
    }

    function togglePlay() {
      if (audio.paused) {
        audio.play();
        updatePlayBtn(true);
      } else {
        audio.pause();
        updatePlayBtn(false);
      }
    }

    function updatePlayBtn(isPlaying) {
      document.getElementById('playIcon').setAttribute('data-lucide', isPlaying ? 'pause' : 'play');
      lucide.createIcons();
    }

    function skip(sec) {
      audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + sec));
    }

    function seek(e) {
      const rect = document.getElementById('progressBar').getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      audio.currentTime = pos * audio.duration;
    }

    function cycleSpeed() {
      currentSpeedIndex = (currentSpeedIndex + 1) % speeds.length;
      const s = speeds[currentSpeedIndex];
      audio.playbackRate = s;
      document.getElementById('speedBtn').innerText = s + 'x';
    }

    audio.addEventListener('timeupdate', () => {
      if (!audio.duration) return;
      const pct = (audio.currentTime / audio.duration) * 100;
      document.getElementById('progressFill').style.width = pct + '%';
      const cur = formatTime(audio.currentTime);
      const tot = formatTime(audio.duration);
      document.getElementById('playerTime').innerText = cur + ' / ' + tot;

      // Save position
      if (currentEpisode) {
        try { localStorage.setItem('pos_' + currentEpisode.id, audio.currentTime); } catch(e) {}
      }
    });

    audio.addEventListener('play', () => updatePlayBtn(true));
    audio.addEventListener('pause', () => updatePlayBtn(false));
    audio.addEventListener('ended', () => {
      updatePlayBtn(false);
      // Autoplay next episode
      if (currentEpisode) {
        const idx = catalog.findIndex(e => e.id === currentEpisode.id);
        const nextIdx = newestFirst ? idx + 1 : idx - 1;
        if (catalog[nextIdx] && catalog[nextIdx].hasAudio) {
          playEpisode(catalog[nextIdx].id);
        }
      }
    });

    function formatTime(sec) {
      if (!sec || isNaN(sec)) return '0:00';
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    }

    loadCatalog();
  </script>
</body>
</html>`;
}
