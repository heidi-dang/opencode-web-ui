# Google AI Studio Review Target

This directory provides a dedicated review environment for Google AI Studio. It allows the canonical OpenCode Web UI application to be previewed without requiring access to a live, private OpenCode backend or Tailscale.

## Purpose

- Allows AI Studio to render the application interface deterministically.
- Verifies UI component behavior visually.
- Validates the structural integrity of the frontend application.

## Relationship to Production

- The canonical production application remains in `packages/app`.
- SolidJS remains the frontend framework.
- Bun remains the production package manager and runtime.
- **This directory (`ai-studio/`) exists only as a compatibility/review target.**
- Production components must be modified at their canonical locations, not duplicated here.
- Production networking must not be replaced with mocks in the canonical application.

## Running the Review Target

To start the review environment, use the standard `npm` commands:

```bash
cd ai-studio
npm install
npm run dev
```

To build:

```bash
npm run build
```

## Review Scenarios Supported

When launched with `npm run dev`, this environment sets specific configuration to activate isolated review mode (e.g. `VITE_APP_RUNTIME=review`).

The review adapter provides fixtures for:

- Connected / Disconnected server states
- Project listing and selected project
- Session list and new session
- Chat UI (user message, assistant streaming, completed response, tool calls)
- Loading and error states
- Model and provider selector

## Limitations

- The review target is powered by deterministic mocks; actual LLM completions or backend executions will not occur.
- No secrets or credentials should be present or needed to run this environment.
