// OpenCode Web UI — Service Worker (cache-first, offline-capable)
// Version bump this string to force all clients to update cache.
const CACHE_VERSION = "oc-shell-v1"

// Resources that form the app shell — cached on install.
const SHELL_URLS = [
  "/",
  "/src/entry.tsx",
  "/assets/Inter.ttf",
  "/assets/JetBrainsMonoNerdFontMono-Regular.woff2",
  "/oc-theme-preload.js",
  "/favicon-v3.svg",
  "/site.webmanifest",
]

// Never intercept these — must always go to network.
const BYPASS_PREFIXES = [
  "/opencode-server",
  "/api/remote-proxy",
  "/api/mobile-log",
  "chrome-extension://",
]

// ─── Install ────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // Use individual adds so a missing asset doesn't abort everything
      Promise.allSettled(SHELL_URLS.map((url) => cache.add(url))),
    ),
  )
})

// ─── Activate ───────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key)),
      ),
    ).then(() => self.clients.claim()),
  )
})

// ─── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET requests
  if (request.method !== "GET") return

  // Skip bypass prefixes (API, backend proxy)
  if (BYPASS_PREFIXES.some((p) => url.pathname.startsWith(p) || request.url.startsWith(p))) return

  // Skip cross-origin requests (CDN fonts, external images, etc.) except same-origin
  if (url.origin !== self.location.origin) return

  event.respondWith(networkFirstWithFallback(request))
})

/**
 * Network-first strategy:
 * 1. Try network; if successful, update cache and return response.
 * 2. If network fails (offline), return cached version.
 * 3. If no cache either, return a simple offline fallback.
 */
async function networkFirstWithFallback(request) {
  const cache = await caches.open(CACHE_VERSION)
  try {
    const networkResponse = await fetch(request)
    // Only cache successful same-origin responses
    if (networkResponse.ok && networkResponse.type !== "opaque") {
      cache.put(request, networkResponse.clone())
    }
    return networkResponse
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached

    // For navigation requests, return the root page so client-side routing works
    if (request.mode === "navigate") {
      const rootCached = await cache.match("/")
      if (rootCached) return rootCached
    }

    // Ultimate fallback — minimal offline response
    return new Response(
      `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>OpenCode — Offline</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0f;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100dvh;padding:1.5rem;text-align:center}
    .card{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:2.5rem;max-width:420px;width:100%}
    h1{font-size:1.5rem;font-weight:600;margin-bottom:.75rem;color:#fff}
    p{font-size:.9rem;color:#888;line-height:1.6;margin-bottom:1.5rem}
    button{background:#6366f1;color:#fff;border:none;border-radius:8px;padding:.65rem 1.5rem;font-size:.9rem;font-weight:500;cursor:pointer;transition:background .2s}
    button:hover{background:#4f46e5}
    .icon{font-size:2.5rem;margin-bottom:1rem}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📡</div>
    <h1>You're offline</h1>
    <p>OpenCode needs a connection to your server. Please check your network and try again.</p>
    <button onclick="location.reload()">Try again</button>
  </div>
</body>
</html>`,
      {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    )
  }
}
