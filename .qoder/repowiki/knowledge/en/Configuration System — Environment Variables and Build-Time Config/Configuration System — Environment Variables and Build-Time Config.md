---
kind: configuration_system
name: Configuration System — Environment Variables and Build-Time Config
category: configuration_system
scope:
    - '**'
source_files:
    - bunfig.toml
    - package.json
---

This repository does not implement a dedicated runtime configuration system. Configuration is handled informally through environment variables and build-time settings:

- **Environment variables**: The codebase reads configuration exclusively via `process.env` in test/benchmark scripts (e.g., `OPENCODE_PERFORMANCE_RUN_ID`, `OPENCODE_PERFORMANCE_TRACE_DIR`, `PLAYWRIGHT_PORT`, `REVIEW_PANE_COMPLETION_TIMEOUT_MS`). There is no centralized config loader, schema validation, or typed config module.
- **Build/runtime tooling config**: `bunfig.toml` at the workspace root controls Bun install behavior (`exact = true`, `minimumReleaseAge = 259200`) and test root directory. This is the only TOML configuration file in the repo.
- **No `.env` files**: No `.env`, `.env.local`, or similar dotenv files are present in the repository.
- **No YAML/JSON config loaders**: No code loads `.yaml`, `.toml`, or `.json` configuration files at runtime. The grep search across all TypeScript files returned zero matches for file-based config loading patterns.
- **Package-level configs**: Each package has its own `package.json` with dependencies and scripts, but these are npm/Bun manifests rather than application configuration.
- **Vite/SolidJS setup**: The app uses Vite with SolidJS; any build-time configuration would be in per-package `vite.config.*` files, but none were found in the scanned scope.

The configuration approach is minimal: environment variables for runtime overrides and `bunfig.toml` for tooling. There is no feature flag system, secrets management, or layered configuration merging.