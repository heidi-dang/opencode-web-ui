// OpenCode Web UI — Service Worker (runtime-cache strategy)
// Version bump this string to force all clients to purge old caches.
const CACHE_VERSION = "oc-shell-v7"

// Only the root HTML document is pre-fetched on install.
const PRECACHE_URLS = ["/"]

// Never intercept these paths — must always hit the live network.
const BYPASS_PREFIXES = [
  "/opencode-server",
  "/api",
  "/servers",
  "/direct",
  "/global",
  "/health",
  "/project",
  "/session",
  "chrome-extension://",
]

// Large binary assets we deliberately skip caching (fonts, WASM, media).
// They will be served by the browser's own HTTP cache instead.
const SKIP_EXTENSIONS = [".ttf", ".woff", ".woff2", ".wasm", ".map", ".png", ".jpg", ".jpeg", ".svg", ".ico", ".aac"]

// ─── Install ────────────────────────────────────────────────────────────────
// Only pre-cache the root page; skip waiting so the SW activates immediately.
self.addEventListener("install", (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      return cache.add("/").catch(() => {})
    }),
  )
})

// ─── Activate ───────────────────────────────────────────────────────────────
// Force purge ALL old cache keys on activation to clear any corrupted entries.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

// ─── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Only intercept GET requests
  if (request.method !== "GET") return

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) return

  // Skip API / proxy / backend / session paths — must always be live network
  if (BYPASS_PREFIXES.some((p) => url.pathname.startsWith(p) || request.url.startsWith(p))) return

  // Skip large binary assets — let the browser HTTP cache handle them
  const pathnameLower = url.pathname.toLowerCase()
  if (SKIP_EXTENSIONS.some((ext) => pathnameLower.endsWith(ext) || pathnameLower.includes(ext))) return

  event.respondWith(networkFirstWithFallback(request))
})

/**
 * Network-first with lazy cache population:
 * 1. Try network → on success, store in cache ONLY if it is root or static asset.
 * 2. On network failure → return cached version if available.
 * 3. For navigation failures with no cache → return cached root or offline page.
 */
async function networkFirstWithFallback(request) {
  const cache = await caches.open(CACHE_VERSION)

  try {
    const networkResponse = await fetch(request)
    if (networkResponse.ok && networkResponse.type !== "opaque") {
      const url = new URL(request.url)
      // ONLY cache / and /assets/ — NEVER cache dynamic routes like /session/*
      if (url.pathname === "/" || url.pathname.startsWith("/assets/")) {
        const contentType = networkResponse.headers.get("content-type") || ""
        // Never cache or return HTML fallback pages for static asset requests.
        // A SPA fallback here causes the browser to report:
        // "text/html is not a valid JavaScript MIME type" for JS chunks.
        if (url.pathname.startsWith("/assets/") && contentType.includes("text/html")) {
          return new Response("Asset not found", {
            status: 404,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        }
        cache.put(request, networkResponse.clone()).catch(() => {})
      }
    }
    return networkResponse
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached

    // For SPA navigation: fall back to the cached root so the router can recover
    if (request.mode === "navigate") {
      const rootCached = await cache.match("/")
      if (rootCached) return rootCached
    }

    // Last resort: styled offline page
    return offlinePage()
  }
}

function offlinePage() {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>OpenCode \u2014 Offline</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0f;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100dvh;padding:1.5rem;text-align:center}
    .card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:2.5rem;max-width:420px;width:100%}
    h1{font-size:1.5rem;font-weight:600;margin-bottom:.75rem;color:#fff}
    p{font-size:.9rem;color:#888;line-height:1.6;margin-bottom:1.5rem}
    button{background:#6366f1;color:#fff;border:none;border-radius:8px;padding:.65rem 1.5rem;font-size:.9rem;font-weight:500;cursor:pointer}
    button:hover{background:#4f46e5}
    .icon{font-size:2.5rem;margin-bottom:1rem}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">\uD83D\uDCE1</div>
    <h1>You're offline</h1>
    <p>OpenCode needs a connection to your server. Please check your network and try again.</p>
    <button onclick="location.reload()">Try again</button>
  </div>
</body>
</html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  )
}
