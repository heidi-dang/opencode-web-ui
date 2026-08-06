export type ModelActivityState =
  | "idle"
  | "active-fast"
  | "active-slow"
  | "waiting-tool"
  | "waiting-input"
  | "stalled"
  | "completed"
  | "error"
  | "disconnected"

export const ActivityConfig = {
  /**
   * The maximum time (ms) between meaningful events to be considered "fast".
   */
  FAST_CADENCE_MS: 1000,

  /**
   * The maximum time (ms) of silence before the model is considered "stalled".
   */
  STALL_THRESHOLD_MS: 15000,

  /**
   * Exponentially Weighted Moving Average (EWMA) smoothing factor.
   * Lower values give more weight to historical cadence, making transitions smoother.
   */
  EWMA_ALPHA: 0.3,

  /**
   * Minimum time (ms) the UI must remain in a state before transitioning, to prevent flickering.
   */
  HYSTERESIS_MS: 500,

  /**
   * How often (ms) the hook re-evaluates the state based on time elapsed.
   */
  EVALUATION_INTERVAL_MS: 250,
}
