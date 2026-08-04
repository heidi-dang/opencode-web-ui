# Setting up Caddy for the OpenCode Web UI

Practical, step-by-step guide for reproducing the exact reverse-proxy setup the
OpenCode Web UI is served behind in production. It mirrors the live
configuration layout and behaviour — only the values are replaced with
placeholders. It contains **no hardcoded hostnames, IP addresses, or private
network identifiers**; replace every `<placeholder>` with your own values.

For the contract the application expects from the proxy (and why each piece
exists), read `docs/deployment/caddy-requirement.md` first.

## Reference setup (what this guide reproduces)

```
Browser ── HTTPS ──► Cloudflare (DNS + TLS fronting)
                      └── HTTPS :443 ──► Caddy (origin, /etc/caddy)
                                           ├── Caddyfile              (global + imports)
                                           └── opencode-ui.Caddyfile  (site block for the UI domain)
                                                 ├── /opencode-server/*  → primary OpenCode backend
                                                 ├── /api/*              → primary OpenCode backend
                                                 ├── /direct/<host>/<port>/* → allowlisted targets
                                                 ├── /servers/<name>/*   → remote OpenCode aliases
                                                 ├── /assets/*           → immutable static assets
                                                 └── /*                  → SPA fallback (index.html)
```

The UI domain terminates TLS at the origin Caddy (automatic with a public
domain). Cloudflare is an optional fronting layer in front of Caddy — see
[Cloudflare fronting](#cloudflare-fronting-optional).

## File layout

Two files:

| File | Purpose |
|---|---|
| `/etc/caddy/Caddyfile` | Global options, local utility sites, and `import` statements pulling in per-site files |
| `/etc/caddy/opencode-ui.Caddyfile` | The complete site block for the OpenCode Web UI domain |

Splitting the site block into its own imported file keeps the UI site isolated
and lets it be managed/replaced independently of the rest of the Caddy config.
Caddy reloads automatically when any imported file changes.

### `/etc/caddy/Caddyfile`

```caddy
# Global options (email for ACME, etc.) live here if needed.

# Other sites may live in this file. The OpenCode Web UI site is kept in its
# own file and imported — Caddy watches imported files and reloads on change.
import /etc/caddy/opencode-ui.Caddyfile

# Further imports for other services (e.g. collaboration/API gateways) follow.
```

### `/etc/caddy/opencode-ui.Caddyfile`

The full site block, exactly matching the live configuration:

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
	# Used for the app's same-origin backend API (servers, projects, sessions).
	handle_path /opencode-server/* {
		reverse_proxy <backend-address>:<backend-port> {
			flush_interval -1
		}
	}

	# API proxy — same target and options as the /opencode-server proxy.
	handle_path /api/* {
		reverse_proxy <backend-address>:<backend-port> {
			flush_interval -1
		}
	}

	# Direct LAN/Tailscale addresses entered in the Web UI are reached through
	# /direct/<host>/<port>/... — the browser cannot fetch a plain HTTP
	# cross-origin address from this HTTPS page (CORS + mixed content), so the
	# request is proxied same-origin here. Only allowlisted hosts can be
	# proxied (keeps this from becoming an open proxy).
	handle /direct/* {
		@dyn path_regexp dyn ^/direct/(<allowed-host-regex>)/([0-9]+)(/.*)?$
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

	# Remote OpenCode servers reachable through the private network (e.g.
	# Tailscale). Each /servers/<name> prefix is stripped before the request is
	# forwarded, so the backend receives plain /path, /project, /file, /api/*
	# routes. Keep in sync with the server URLs configured in the Web UI
	# settings. Repeat this block per configured server.
	handle_path /servers/<server-name>/* {
		reverse_proxy <remote-address>:<remote-port> {
			flush_interval -1
			header_up Connection {http.request.header.Connection}
			header_up Upgrade {http.request.header.Upgrade}
		}
	}

	# Immutable build assets — filenames are content-hashed, so they can be
	# cached for a year with "immutable".
	@immutable path /assets/*
	handle @immutable {
		root * <web-root>
		header Cache-Control "public, max-age=31536000, immutable"
		try_files {path} =404
		file_server
	}

	# SPA fallback — any other path serves index.html so client-side routes
	# (e.g. /session/<id>) do not 404 on refresh.
	handle {
		root * <web-root>
		header Cache-Control "no-cache"
		try_files {path} /index.html
		file_server
	}
}
```

## Placeholders

| Placeholder | Meaning | Example |
|---|---|---|
| `<frontend-domain>` | The public domain the UI is served on | `ui.example.com` |
| `<backend-address>` / `<backend-port>` | The primary OpenCode backend (the local server) | `10.0.0.5` / `4096` |
| `<web-root>` | Absolute path to the Vite build output | `/var/www/opencode-web-ui/current` |
| `<allowed-host-regex>` | `/direct` allowlist regex — see below | see the `/direct` allowlist section |
| `<server-name>` | A short alias shown/used for a remote server | `workstation` |
| `<remote-address>` / `<remote-port>` | Address of that remote OpenCode server | `10.0.0.9` / `4096` |

### The `/direct` allowlist

The regex in `path_regexp dyn` enumerates the hosts the proxy is allowed to
forward to. The live setup uses a CGNAT private-range alternative
(`100.64.0.0/10`, used by Tailscale), a few individually allowlisted addresses,
and loopback names:

```
100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3}   # 100.64.0.0/10 (CGNAT/Tailscale)
localhost|127\.0\.0\.1|::1                                            # loopback
```

To reproduce this without leaking specific addresses, replace the static
entries with your own:

```caddy
@dyn path_regexp dyn ^/direct/(100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3}|<host-a>|<host-b>|localhost|127\.0\.0\.1|::1|<name-a>|<name-b>)/([0-9]+)(/.*)?$
```

`<host-a>`, `<host-b>`, `<name-a>`, `<name-b>` are the specific addresses or
hostnames you actually use. Keep the allowlist explicit and minimal — a broad
pattern turns the proxy into an open proxy.

## Deployment steps

1. **Build the app** and place the output at `<web-root>`:

   ```bash
   bun --cwd packages/app build
   ```

   Point `<web-root>` at the build output (the live setup uses a
   `releases/<timestamp>-<commit>` directory behind a `current` symlink, so the
   site always serves a known-good build):

   ```bash
   mkdir -p /var/www/opencode-web-ui/releases/<timestamp>-<commit>
   cp -r packages/app/dist/* /var/www/opencode-web-ui/releases/<timestamp>-<commit>/
   ln -sfn /var/www/opencode-web-ui/releases/<timestamp>-<commit> /var/www/opencode-web-ui/current
   ```

2. **Write the Caddy config** — create `/etc/caddy/opencode-ui.Caddyfile` from
   the template above, fill in your placeholders, and add the `import` line to
   `/etc/caddy/Caddyfile` if not present.

3. **Validate and reload:**

   ```bash
   caddy validate --config /etc/caddy/Caddyfile
   systemctl reload caddy        # or: caddy reload --config /etc/caddy/Caddyfile
   ```

   (Caddy also picks up imported-file changes automatically, but validate first
   to catch syntax errors.)

4. **Verify** (see the checklist below).

## Cloudflare fronting (optional)

If Cloudflare sits in front of Caddy, the domain's DNS record for
`<frontend-domain>` is proxied through Cloudflare and its edge terminates the
public TLS connection, forwarding to the origin Caddy on `:443`. The Caddy site
block is unchanged in this mode. When Cloudflare is used, remember that a
backend failure at the origin is surfaced as a Cloudflare-branded 502/524 page
to the browser — the origin is the layer to investigate first.

## Verification checklist

- [ ] `curl -I https://<frontend-domain>/` returns `200` with the SPA `index.html`.
- [ ] `curl -I https://<frontend-domain>/some/client/route` also returns `200`
      (SPA fallback — not a 404).
- [ ] `curl -I https://<frontend-domain>/assets/...` returns
      `Cache-Control: public, max-age=31536000, immutable`.
- [ ] `curl https://<frontend-domain>/opencode-server/health` returns a backend
      response (streaming works — updates arrive without buffering).
- [ ] `curl https://<frontend-domain>/api/...` returns the backend's response
      (e.g. `401` when unauthenticated), **not** the SPA `index.html`.
- [ ] `curl https://<frontend-domain>/direct/<allowed-host>/<port>/health`
      returns the target's health response; a host **not** on the allowlist
      returns `403`.
- [ ] `curl https://<frontend-domain>/servers/<server-name>/health` returns the
      remote server's response.
- [ ] An interactive terminal session connects (WebSocket upgrade passes
      through — `Connection`/`Upgrade` headers on `/direct` and `/servers`).
- [ ] A running session streams output in the UI without stalling
      (`flush_interval -1` on backend proxies).

## Related

- `docs/deployment/caddy-requirement.md` — the path contract and why the proxy
  is required
- `docs/deployment/security-headers.md` — recommended response headers
- `docs/upstream/opencode-deployment-contract.md` — running the backend OpenCode
  server
