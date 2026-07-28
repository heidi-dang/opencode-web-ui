/**
 * Better Harness feature module for OpenCode Web UI.
 *
 * Provides project-level analysis and repair capabilities through
 * the FlowDeck Better Harness engine.
 */
export { BetterHarnessPage } from "./pages/BetterHarnessPage";
export { BetterHarnessUnavailable } from "./components/BetterHarnessUnavailable";
export { createBetterHarnessStore } from "./stores/better-harness";
export { HttpHarnessDataSource } from "./api/harness-data-source";
export { discoverBetterHarness } from "./utils/runtime-resolver";
export type { BetterHarnessRuntimeInfo } from "./utils/runtime-resolver";
export type { HarnessReport, HarnessRunProgress, HarnessFinding, HarnessDimensionScore } from "./types";
