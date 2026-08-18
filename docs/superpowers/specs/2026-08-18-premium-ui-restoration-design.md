# Premium Session UI Restoration Design

## Goal

Restore the visual and interaction polish from commits `b22afc9` and `1c98827` on the current stable runtime without changing connection, SSE, execution, provider, model, or interrupt state machines.

## Source of truth

Session activity, interrupting state, todos, tokens, and cost come from the current synchronized session stores. Token usage and cost are the values published by the SessionRunner/model-pricing path introduced by `908e47b`; the browser does not recalculate cost or infer usage from rendered text.

## Restoration ledger

| Historical item | Decision | Current treatment |
| --- | --- | --- |
| StreamingStatusBar | Adapt | Keep the current localized phrases, waveform, ticker, and cleanup; add an explicit V2 guard and consume current activity/interrupt state. |
| SessionProgressRing | Restore adapted | Recreate as a defensive presentation component using current Todo statuses, including cancelled and partial payloads. |
| Todo entrance/completion/glow animations | Restore adapted | Add presentation-only classes and reduced-motion handling; no store mutation. |
| Composer streaming glow | Restore adapted | Bind to current authoritative working/interrupting state and remove it on terminal/reconnect states. |
| Historical streaming event parser | Do not restore | Use the current canonical activity classification instead of old `tool_call`/`step` assumptions. |
| NumberTicker | Already present | Retain and test with canonical session token/cost updates. |
| Token/cost display | Already present, validate | Read `session.tokens` and `session.cost`; do not double-count or recalculate. |
| Prompt selector width constraints | Adapt | Port only missing `min-w-0`, shrink, and submit-button constraints around current Stop controls. |
| Todo panel sizing | Adapt | Restore bounded V2 height and mobile-safe overflow without replacing current dock behavior. |
| HEIDI branding | Restore UI-only | Apply only intentional channel/debug presentation text; never alter internal runtime values. |
| Server health provider/model polling | Reject | Current registered-server health is canonical; avoid duplicate model requests and polling storms. |
| Highlighter preload | Reject | Current lazy loading protects startup and bundle size; no eager language preload. |
| Historical logs/registry/runtime artifacts | Reject | No runtime data, credentials, logs, or generated artifacts. |
| Complete provider catalog in Settings | New adapted fix | Render all providers from the connected server catalog and mark connected providers separately. |
| Session Server Status widget | New adapted fix | Keep the persisted `showStatus` preference and render current server metadata reactively without new polling. |

## Invariants

- `RUNNING`, `INTERRUPTING`, reconnect, and idle state transitions remain owned by the current runtime.
- V1 layout and protocol behavior remain unchanged unless a shared presentation component is explicitly safe.
- Reduced-motion users receive no looping animation.
- A missing, partial, or malformed todo/telemetry payload renders safely.
- Provider load failures remain errors, never successful empty catalogs.
- Server Status visibility follows the existing persisted setting and updates without reload.
