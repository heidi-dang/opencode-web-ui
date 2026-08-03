# Caddy (Reverse Proxy) Requirement for the OpenCode Web UI

This document describes why the OpenCode Web UI requires a reverse proxy such as Caddy in front of it, what the application expects from the proxy, and a minimal, fully generic configuration. It contains no hardcoded hostnames, IP addresses, or private network identifiers — replace every `<placeholder>` with your own values.

## Why a reverse proxy is required

1. **Static SPA hosting.** The app is a client-side single-page application (Vite build output). It must be served as static files with a client-side routing fallback — no Node server is shipped for production hosting.

2. **Same-origin API access.** The application makes API requests against the origin it is served from (for example the Better Harness API under `/api/v1/...`). Those requests must be forwarded to the backend OpenCode server. Without a reverse proxy, the browser would have to reach the backend directly.

3. **Mixed-content and CORS avoidance.** When the UI is served over HTTPS and a user-configurable backend target uses plain HTTP, the browser will block the direct request (mixed content) and/or fail cross-origin checks. The proxy solves this by terminating those requests same-origin and forwarding them server-side.

4. **Credential confinement.** Backend credentials (Basic auth) are applied by the proxy or by the backend itself, never exposed to the browser as cross-origin data.

5. **Streaming and WebSocket support.** Session streaming (SSE) and interactive terminals (WebSocket) require the proxy to pass through streaming responses and upgrade headers instead of buffering them.

6. **Secure-by-default fronting.** TLS termination, HTTP/2/3, caching policy for immutable assets, and security response headers are all provided at the proxy layer.

## What the application expects (path contract)

| Path pattern | Purpose | Repo reference behaviour |
|---|---|---|
| `/assets/*` | Fingerprinted build assets. Must be cached as immutable. | Vite build output under `assets/` |
| `/` (and any client route) | SPA entry. Must fall back to `index.html`. | Client-side routing |
| `/opencode-server/*` | Backend proxy prefix. The prefix is **stripped** before forwarding. | Dev-server proxy contract (`vite.config.ts`) |
| `/api/*` | Same-origin backend API. Forwarded as-is. | e.g. Better Harness API under `/api/v1/servers/...` |
| `/direct/<host>/<port>/*` | Dynamic same-origin proxy for user-configured plain-HTTP targets when the UI is on an HTTPS origin. `<host>/<port>` are decoded from the path and used as the upstream. **Must be allowlisted.** | `getEffectiveServerUrl()` in `utils/server.ts` |
| `/servers/<name>/*` | Optional per-server aliases for remote OpenCode instances. Prefix is stripped before forwarding. | Web UI server configuration |

## Minimal Caddy configuration

Placeholders: `<frontend-domain>` (your public domain), `<backend-address>` / `<backend-port>` (the OpenCode server), `<web-root>` (path to the build output), and `<allowed-host-or-network>` (see the `/direct` allowlist note below).

```caddy
<frontend-domain> {
	encode zstd gzip

	header {
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		Permissions-Policy "camera=(), microphone=(), geolocation=()"
		-Server
	}

	# Backend proxy prefix — prefix is stripped before forwarding.
	handle_path /opencode-server/* {
		reverse_proxy <backend-address>:<backend-port> {
			flush_interval -1
		}
	}

	# Same-origin backend API — forwarded as-is.
	handle_path /api/* {
		reverse_proxy <backend-address>:<backend-port> {
			flush_interval -1
		}
	}

	# Dynamic same-origin proxy for user-configured plain-HTTP targets.
	# <host> and <port> are taken from the path and used as the upstream.
	#
	# SECURITY: this must be restricted to an explicit allowlist (private
	# networks, loopback, and approved hosts). A catch-all here would turn
	# the proxy into an open proxy.
	handle /direct/* {
		@dyn path_regexp dyn ^/direct/(<allowed-host-or-network>)/([0-9]+)(/.*)?$
		handle @dyn {
			uri strip_prefix /direct/{re.dyn.1}/{re.dyn.2}
			reverse_proxy {re.dyn.1}:{re.dyn.2} {
				flush_interval -1
				header_up Connection {http.request.header.Connection}
				header_up Upgrade {http.request.header.Upgrade}
			}
		}
		respond 403
	}

	# Optional per-server aliases for remote OpenCode instances.
	# Prefix is stripped before forwarding. Repeat per configured server.
	handle_path /servers/<server-name>/* {
		reverse_proxy <remote-address>:<backend-port> {
			flush_interval -1
			header_up Connection {http.request.header.Connection}
			header_up Upgrade {http.request.header.Upgrade}
		}
	}

	# Immutable build assets.
	@immutable path /assets/*
	handle @immutable {
		root * <web-root>
		header Cache-Control "public, max-age=31536000, immutable"
		try_files {path} =404
		file_server
	}

	# SPA fallback — any other path serves index.html.
	handle {
		root * <web-root>
		header Cache-Control "no-cache"
		try_files {path} /index.html
		file_server
	}
}
```

## Key configuration points and why

- **`flush_interval -1`** on backend proxies — disables response buffering so SSE streaming reaches the browser in real time. Without it, streaming session output may stall or batch.
- **`Connection` / `Upgrade` passthrough** on `/direct` and `/servers` proxies — required for WebSocket upgrades (interactive terminals). Apply it to any backend path that serves WebSockets.
- **`handle_path` vs `handle`** — `handle_path /opencode-server/*` strips the prefix before forwarding; `handle /direct/*` keeps the matched path so the pattern regex can extract the upstream host/port. These are not interchangeable.
- **`/direct` allowlist** — the regex must enumerate the private ranges and approved hosts you actually use. Keep it explicit and minimal; a broad pattern is an open-proxy vulnerability.
- **Immutable `/assets/*` caching** — long `Cache-Control` with `immutable` because asset filenames are content-hashed; a wrong cache policy here is harmless, a missing SPA fallback is not.
- **SPA fallback** — `try_files {path} /index.html` must be the final handler so client-side routes (e.g. `/session/<id>`) do not 404 on refresh.

## Deployment checklist

- [ ] Build the app (`bun --cwd packages/app build`) and point `<web-root>` at the build output directory.
- [ ] Terminate TLS at the proxy (automatic with Caddy and a public domain).
- [ ] Configure the `/direct` allowlist to your private network range(s) and approved hosts only.
- [ ] Configure `/servers/<name>` entries to match the server URLs shown in the Web UI settings.
- [ ] Confirm streaming: a running session should update in the UI without buffering.
- [ ] Confirm WebSockets: an interactive terminal session should connect.
- [ ] Apply the security response headers (see `docs/deployment/security-headers.md`).
- [ ] Verify an unauthenticated request to `/api/*` returns a backend response (e.g. `401`), **not** the SPA `index.html`.

## Related

- `docs/deployment/security-headers.md` — recommended response headers
- `docs/upstream/opencode-deployment-contract.md` — running the backend OpenCode server
