# OpenCode Web UI (Standalone)

This is the standalone OpenCode Web UI application extracted from the OpenCode monorepo.

## Getting Started

### 1. Install Dependencies
```bash
bun install
```

### 2. Development Mode
Run the Web UI dev server locally:
```bash
bun dev
```
This starts Vite development server on `http://localhost:3000`.

### 3. Build for Production
Build static web assets for deployment:
```bash
bun build
```
The compiled static output will be generated inside `packages/app/dist`.

### 4. Deploying
Deploy the `packages/app/dist` folder to any static web host:
- **Vercel / Netlify / Cloudflare Pages**
- **Nginx / Caddy / Docker**
- **AWS S3 / CloudFront**

### 5. Connecting to Backend
When running the Web UI, point it to your running `opencode server` instance:
- By configuring your server URL in the Web UI connection dialog.
- Or by opening the app with a query parameter: `http://your-ui-domain.com/?auth_token=YOUR_SERVER_TOKEN`.
