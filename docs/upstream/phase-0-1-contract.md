# Phase 0–1 Contract: Official OpenCode Server API

## Source of Truth

The official OpenCode repository (`anomalyco/opencode`, branch `dev`, SHA `7534d23551f665e65080809975b4ca5c7d63807b`) and its running `/doc` endpoint define the canonical API.

## API Endpoints

### Health
- `GET /global/health` — returns server health status
- No authentication required
- Response: `{ "status": "ok", "version": "..." }`

### SSE Event Stream
- `GET /event` — Server-Sent Events stream for real-time updates
- Uses `text/event-stream` content type
- Supports Basic Auth via `Authorization` header
- Events: session updates, tool activity, terminal output, etc.
- Must stream incrementally (no buffering)
- Reconnect supported via standard SSE `Last-Event-ID`

### API Documentation
- `GET /doc` — OpenAPI/Swagger-style contract describing all available endpoints

### CORS
- Official server supports `--cors` flag to set `Access-Control-Allow-Origin`
- Explicit origin required; wildcard not recommended
- Preflight (`OPTIONS`) requests handled when CORS is enabled

### Basic Auth
- Supported via `Authorization: Basic <base64>` header
- Credentials: `OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD` env vars
- 401 returned when auth is configured and missing
- 403 returned when auth is configured and invalid

## Local Files: Upstream-Derived

| File | Status |
|---|---|
| packages/app/vite.config.ts | Upstream-derived + standalone additions (proxy, mobile log) |
| packages/app/vite.js | Identical to upstream |
| packages/app/src/app.tsx | Upstream-derived |
| packages/app/src/entry.tsx | Upstream-derived |
| packages/app/src/context/server.tsx | Upstream-derived |
| packages/app/src/utils/server-health.ts | Upstream-derived |
| packages/sdk | Upstream-derived |
| packages/client | Vendored tarball deviation |

## Local Files: Standalone Adaptations

| File | Adaptation |
|---|---|
| packages/app/vite.config.ts | Added remote-proxy plugin, mobile-log plugin, /opencode-server dev proxy |
| (various) | Remote server wizard, credential persistence, mobile layout |

## Behaviours Removed in Phase 1

1. `X-Target-URL` / `/api/remote-proxy` SSRF proxy — removed entirely
2. `/api/mobile-log` — removed or strictly gated to dev mode
3. `allowedHosts: true` — replaced with explicit list
4. `host: "0.0.0.0"` — default changed to loopback
5. Password in `localStorage` — migrated to memory/session-only
6. Unsafe `btoa()` for non-ASCII credentials — replaced with UTF-8-safe encoding

## Contract Principle

> The standalone UI cannot create frontend-only backend endpoints or rely on
> request-selected forwarding destinations. Production connections must target
> an official opencode serve instance directly or through fixed deployment
> infrastructure that does not alter the API contract.
