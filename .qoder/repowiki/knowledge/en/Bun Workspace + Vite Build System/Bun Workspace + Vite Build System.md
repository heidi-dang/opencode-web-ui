---
kind: build_system
name: Bun Workspace + Vite Build System
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - bunfig.toml
    - tsconfig.json
    - packages/app/package.json
    - packages/app/vite.config.ts
---

This project uses a Bun-managed monorepo workspace with Vite as the build tool for the SolidJS frontend application. The build system is organized around a root-level package.json that defines workspace packages and centralized dependency versions via Bun's catalog feature.

**Core Build Tools & Configuration:**
- **Package Manager**: Bun (version 1.3.14) configured via `bunfig.toml` with strict version pinning (`exact = true`) and a minimum release age of 3 days for dependency updates
- **Build Tool**: Vite 7.1.4 with SolidJS plugin for the main application in `packages/app`
- **TypeScript**: Version 5.8.2 with native TypeScript compiler preview (`@typescript/native-preview`) used for type checking
- **Workspace Structure**: Monorepo with multiple packages under `packages/*`, each with their own `package.json` and dependencies

**Build Scripts & Commands:**
- Root-level scripts delegate to `packages/app`: `dev`, `build`, `serve`, `preview`, and `typecheck` all run through Bun's `--cwd` flag
- Application-specific scripts include unit testing with Happy DOM, browser testing, Playwright E2E tests, and performance benchmarks
- Type checking uses the native TypeScript compiler (`tsgo -b`) for faster builds

**Dependency Management Strategy:**
- Centralized dependency versions in root `package.json` catalog section
- Local vendored dependencies (e.g., `@opencode-ai-client` from `vendor/` directory)
- Extensive use of patches in the `patches/` directory for fixing upstream dependencies
- Workspace protocol (`workspace:*`) for internal package references

**Build Process:**
- Vite configuration includes Sentry integration for error tracking and source map generation
- Development server proxies `/opencode-server` requests to a local backend on port 4096
- Custom plugins handle mobile debugging logs and remote proxy functionality
- Build targets ESNext with optional sourcemap generation based on environment variables

**Testing Infrastructure:**
- Unit tests run with Bun's built-in test runner using Happy DOM for browser APIs
- Browser tests use Playwright with separate configurations for different test types
- Performance and stability tests are integrated into the test suite

The build system prioritizes fast iteration during development while maintaining strict dependency management and comprehensive testing across unit, browser, and end-to-end scenarios.