# Model Activity Waveform Design

## Goal

Replace the streaming status bar's pulsing dot with a theme-aware ECG waveform inspired by the supplied neon heartbeat reference. The waveform must travel from the status label toward token telemetry, repeat continuously while the model works, and visibly respond to real model activity cadence.

## Layout

- Desktop order: contextual working phrase, flexible waveform track, token/cost telemetry, elapsed timer.
- Mobile order: flexible waveform track, token telemetry, elapsed timer. The waveform replaces the compact working label to maximize travel distance.
- Before telemetry is available, the track expands toward the timer or right edge. When telemetry appears, flex layout contracts the track without overflowing or shifting the status bar vertically.
- The existing heartbeat dot is removed from the telemetry pill.

## Visual Treatment

The waveform is an inline decorative SVG with two layers:

1. A faint continuous signal rail that shows the complete ECG path.
2. A bright traveling segment with a soft trailing glow that crosses the rail from left to right.

Theme tokens determine the signal color. Dark themes retain an electric-neon glow; light themes use controlled contrast without excessive bloom. The token pill receives a subtle synchronized glow as the traveling segment reaches its endpoint. No element changes size or position during a pulse.

The reference photograph is a visual guide only and is not shipped as a raster asset. SVG keeps the result sharp, themeable, lightweight, and accessible at every viewport size.

## Activity Mapping

The existing `useModelActivity` hook remains the source of activity state, elapsed silence, and EWMA event cadence. A pure profile function maps those values to bounded CSS variables so it can be tested without rendering:

- `active-fast`: short crossing duration, high amplitude, strong glow.
- `active-slow`: moderate crossing duration and amplitude.
- `waiting-tool` and `waiting-input`: slower amber waveform.
- `stalled`: dim, low-frequency amber waveform.
- `error` and `disconnected`: stationary red broken-signal treatment.
- `idle` and `completed`: static faint waveform if rendered.

Within active states, EWMA continuously adjusts duration, amplitude, and glow rather than switching between two visibly abrupt presets. Values are clamped to prevent frantic or sluggish animation. New meaningful activity briefly raises signal energy through the same reactive profile without causing layout work.

## Components and Data Flow

- `StreamingStatusBar` owns placement and passes the current session ID into the waveform track.
- `ModelActivityHeartbeat` is replaced or renamed as a waveform component with the same accessible model-state source.
- The waveform component reads `state`, `ewma`, and activity age from `useModelActivity`, derives a motion profile, and exposes it through CSS custom properties and state data attributes.
- CSS performs continuous movement using transforms and opacity. SVG geometry remains stable, avoiding per-event DOM reconstruction and layout thrashing.
- The telemetry pill remains responsible only for tokens and cost.

## Accessibility and Motion Preferences

- The SVG is `aria-hidden` because the existing status bar and model-state label already provide semantic status information.
- Tooltips and screen-reader text continue to describe active, waiting, stalled, and error states.
- Under `prefers-reduced-motion: reduce`, travel and synchronized pill animation stop. A static waveform remains visible, and its color/brightness still reflects the current state.
- Color is not the only state cue: motion behavior and accessible labels also convey state.

## Performance Constraints

- Record a production timeline benchmark before editing session UI, per repository guidance, and compare it after implementation.
- Animate only compositor-friendly transforms and opacity.
- Do not use canvas, continuous JavaScript animation loops, raster assets, layout measurements per frame, or DOM creation per SSE event.
- Keep the waveform component bounded by flexbox with `min-width: 0` and overflow clipping.
- Preserve the current SSE batching and todo-stream performance characteristics.

## Test-First Implementation

Before production changes, add failing tests for:

- cadence-to-profile mapping and clamping;
- state overrides for waiting, stalled, error, and reduced-motion behavior;
- removal of the old dot from telemetry;
- waveform placement between status and telemetry on desktop;
- mobile replacement of the compact working label;
- behavior before and after token telemetry appears;
- horizontal overflow, console errors, and accessible labeling.

Then implement the smallest code needed to pass, refactor while green, and rerun the relevant unit, browser, typecheck, build, and performance suites.

## Browser Acceptance Criteria

- The flow under test is: open an actively streaming session, observe the waveform cross the status bar, increase event cadence, observe faster/higher pulses, then verify telemetry appears without overflow or vertical layout shift.
- Validate desktop and 390-by-844 mobile viewports.
- Validate normal and reduced-motion preferences.
- Confirm meaningful content, no framework overlay, no relevant console errors, correct status/telemetry ordering, and a working target interaction.
- Capture post-change screenshots outside the repository for visual comparison with the supplied reference.
- Browser plugin is preferred when available; otherwise use the repository Playwright workflow and record the fallback.

## Out of Scope

- Changing SSE protocol semantics or model activity event classification.
- Shipping or editing the supplied raster photograph.
- Redesigning the token pill, timer, composer, or broader session header.
- Adding sound, vibration, or user-configurable waveform themes.
