# OpenCode Web UI

## Architecture
The canonical production application is `packages/app`.
Do not replace SolidJS with React.
Do not rewrite the application architecture.
Do not replace Bun in the production runtime.

## Google AI Studio
The `ai-studio/` directory exists only to provide a Google AI Studio
review environment.
Use `ai-studio/` when launching the live preview.
Reuse production components and styles wherever possible.
Do not move AI Studio-specific mocks into production code.

## UI modifications
When asked to modify the interface:
1. inspect the existing production component;
2. modify the canonical component;
3. ensure the AI Studio review adapter still renders it;
4. preserve desktop and mobile behaviour.

## Backend
The production application connects to registered OpenCode servers.
The AI Studio review runtime may emulate those APIs only for visual
review when a real server is unavailable.
Never replace the production server/gateway implementation with mocks.
Never hardcode credentials or Tailscale/private endpoints in source.
