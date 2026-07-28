---
kind: dependency_management
name: Bun Workspace with Catalog, Lockfile, and Patched Dependencies
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - bunfig.toml
    - bun.lock
    - patches/solid-js@1.9.10.patch
    - patches/effect@4.0.0-beta.83.patch
---

This repository uses **Bun** as the package manager for a multi-package workspace. Dependency management is centralized through three key mechanisms: a root `package.json` workspace catalog, a deterministic `bun.lock` lockfile, and a `patches/` directory for vendored fixes to third-party packages.

### System and Tools
- **Package manager**: Bun (enforced via `packageManager: "bun@1.3.14"`).
- **Workspace layout**: Monorepo under `packages/*`, with each subdirectory being an independent npm package that can depend on other workspace packages via `workspace:*`.
- **Lockfile**: `bun.lock` (lockfileVersion 1) records exact resolved versions for every dependency across all workspaces.
- **Patch system**: `patchedDependencies` in the root `package.json` maps specific package@version pairs to patch files under `patches/`, applied automatically by Bun during install.

### Centralized Version Management (Catalog)
The root `package.json` defines a `workspaces.catalog` section listing ~60 shared dependencies with pinned versions. Individual packages reference these via the `catalog:` protocol instead of repeating version strings — e.g., `typescript: "catalog:"`, `effect: "catalog:"`. This ensures a single source of truth for shared library versions across the monorepo.

### Strict Install Policy
`bunfig.toml` enforces:
- `exact = true`: only exact versions are installed; no semver ranges are allowed.
- `minimumReleaseAge = 259200` (3 days): newly published packages are rejected unless they have been available for at least 3 days, reducing supply-chain risk from freshly released code.
- A long `minimumReleaseAgeExcludes` list whitelists internal or fast-moving packages (`@opentui/*`, `@ff-labs/*`, `@pierre/*`, electron-builder artifacts, etc.) that must be allowed even when brand new.

### Vendoring and Private Packages
- The app package depends on `@opencode-ai/client` via a local tarball path `file:vendor/opencode-ai-client-1.17.13-v2.tgz`, indicating a vendored private client bundle not pulled from a registry.
- Some dependencies use GitHub direct references (e.g., `ghostty-web` pinned to a specific commit SHA), bypassing registries entirely.

### Patch Strategy
The `patches/` directory contains 14 `.patch` files covering AI SDK providers (`@ai-sdk/google`, `@ai-sdk/mistral`, `@ai-sdk/xai`), infrastructure packages (`gcp-metadata`, `pacote`, `@npmcli/agent`), UI libraries (`solid-js`, `@tanstack/virtual-core`), and internal tools (`effect`, `@modelcontextprotocol/sdk`). Each patch is declared in `patchedDependencies` so Bun applies it deterministically during install. There is also a shell script `install-korean-ime-fix.sh` bundled alongside patches, suggesting OS-specific post-install fixes.

### Conventions Observed
- All shared dependencies go through the `catalog:` mechanism — individual packages should not pin versions directly.
- Third-party dependencies are kept at exact versions; ranges are not used.
- New dependency additions require going through the central catalog and may need a corresponding patch if upstream behavior needs adjustment.
- Internal packages communicate via `workspace:*` references, keeping inter-package coupling explicit and version-free.