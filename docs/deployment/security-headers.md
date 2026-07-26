# Security Headers for Production Deployment

## Recommended Headers

When deploying the OpenCode Web UI behind a reverse proxy (nginx, Caddy, Cloudflare, etc.), configure these HTTP response headers:

| Header | Value | Purpose |
|---|---|---|
| `Content-Security-Policy` | See below | Restrict resource origins |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | Enforce HTTPS |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Control referrer info |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), interest-cohort=()` | Restrict browser features |
| `X-Frame-Options` | `DENY` | Prevent clickjacking |

## Content-Security-Policy

The application connects to user-configured OpenCode server instances. The CSP must allow `connect-src` for every approved server origin.

### Minimum CSP (static assets only, no external server connections):

```
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self' ws: wss:;
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
```

### CSP with specific OpenCode server origins:

```
connect-src 'self' ws: wss: https://opencode-server.example.com https://api.opencode.internal;
```

> **Important:** `'unsafe-inline'` is currently required for the theme-preload inline script. In production, either generate a CSP hash for that specific script and replace `'unsafe-inline'` with the hash, or extract the theme script to an external file.

## Cache Headers

- **Hashed assets** (`assets/*-<hash>.*`): `Cache-Control: public, max-age=31536000, immutable`
- **`index.html`**: `Cache-Control: no-cache, no-store, must-revalidate`
- **Service Worker** (`sw.js`): `Cache-Control: no-cache`

## Example nginx Configuration

```nginx
server {
    listen 443 ssl;
    server_name opencode-webui.example.com;

    # SSL configuration
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Security headers
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self';";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy "strict-origin-when-cross-origin";
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), interest-cohort=()";
    add_header X-Frame-Options DENY;

    # Cache control
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files $uri /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    location /sw.js {
        add_header Cache-Control "no-cache";
    }
}
```

## Verification

Test your deployment with:

- https://securityheaders.com/
- https://csp-evaluator.withgoogle.com/
- Browser DevTools → Network → Response Headers
