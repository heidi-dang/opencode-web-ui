# Web UI control server

The browser has two deliberate paths during migration. Control-plane requests use `Web UI API → AgentBackendManager → AgentBackend → OpenCodeAdapter → OpenCode`; the existing SDK compatibility and streaming path remains `browser SDK → compatibility gateway → OpenCode` to preserve token latency and v1/v2 behavior.

In the normal Bun Web UI runtime, both paths are mounted by the Web UI server on the same browser origin. The standalone `scripts/opencode-proxy.ts` process is an optional split/debug adapter for deployments that need a separate process; it is not required by the normal Web UI development/runtime command.

The compatibility gateway is an intentional data-plane exception to the managed control runtime: it preserves the existing browser SDK request and SSE behavior, while backend identity, health, credentials, and control-plane lifecycle remain owned by the server-side runtime. It must still resolve registered backends server-side and never expose a direct browser-to-OpenCode route.

`AgentBackend` exposes normalized projects, sessions, models, providers, health, prompts, interruption, capabilities, and events. OpenCode-specific payloads remain under adapter extensions. A future `adapters/deepseek-harness/DeepSeekHarnessAdapter` can implement the same contract; DeepSeek-only plugins, Cordis plugins, compositions, workers, and runtime extensions belong under `extensions.deepseekHarness` or a backend extension route.

The control-plane database owns backend identity, encrypted credentials, health snapshots, preferences, workspaces, and session indexes. OpenCode remains authoritative for messages and session data. Backend `id` and `type` are immutable. Registry cutover is deterministic: `LEGACY_ONLY → IMPORTING → DATABASE_PRIMARY`; after import, reads and writes are database-only and the JSON file is retained as rollback/reference material without dual-write.

EventHub uses bounded per-subscriber queues and isolates slow consumers. Cache is bounded acceleration only and must be invalidated on mutations. Circuit recovery probes are privileged and separate from normal requests, allowing an OPEN circuit to recover. Network policy is deployment-configured because localhost, LAN, private IP, and Tailscale endpoints are supported intentionally; credentials are injected only server-side and unsafe redirects are not trusted.
