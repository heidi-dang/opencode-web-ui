# OpenCode Server Deployment Contract

## Running the Official Server

```bash
# Local development (loopback only)
opencode serve --hostname 127.0.0.1 --port 4096

# With Basic Auth
OPENCODE_SERVER_USERNAME="<username>" \
OPENCODE_SERVER_PASSWORD="<strong-password>" \
opencode serve --hostname 127.0.0.1 --port 4096

# With CORS for frontend access
opencode serve \
  --hostname "<trusted-interface>" \
  --port "<server-port>" \
  --cors "https://<frontend-origin>"
```

## Important Notes

1. **Local use**: Bind to `127.0.0.1` (loopback) when frontend and server are on the same machine.
2. **Remote access**: Always use HTTPS for remote OpenCode server connections. Never expose the server without TLS.
3. **CORS origin**: Must be explicit — do not use `*` in production. The frontend origin must match exactly.
4. **Authentication**: Configured via official OpenCode env vars (`OPENCODE_SERVER_USERNAME`, `OPENCODE_SERVER_PASSWORD`). The frontend does not manage the backend process.
5. **Frontend connections**: The frontend connects directly to the OpenCode server. No custom backend API is required.
6. **SSE**: The frontend uses the official `/event` SSE stream for real-time updates. WebSocket replacement is not supported.

## Frontend Configuration

The frontend connects to a server through the server wizard UI. The server URL must point to a running `opencode serve` instance.

For development, set:
```bash
VITE_OPENCODE_SERVER_URL=http://127.0.0.1:4096
```
