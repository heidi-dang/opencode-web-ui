/**
 * SolidJS store for Better Harness state management.
 */
import { createStore, produce } from "solid-js/store";
import { createSignal, createResource, onCleanup } from "solid-js";
import { HttpHarnessDataSource } from "../api/harness-data-source";
import type { HarnessReport, HarnessRunProgress } from "../types";

export interface BetterHarnessState {
  /** Whether BH is available on the current server. */
  available: boolean;
  availableReason?: string;
  /** The current report (undefined when no report exists). */
  report?: HarnessReport;
  /** Historical reports. */
  history: HarnessReport[];
  /** Active run progress. */
  runProgress?: HarnessRunProgress;
  /** Whether a run is in progress. */
  running: boolean;
  /** Loading states. */
  loading: boolean;
  /** Error state. */
  error?: string;
}

const initial: BetterHarnessState = {
  available: false,
  history: [],
  running: false,
  loading: false,
};

export function createBetterHarnessStore(config: {
  baseUrl: string;
  serverKey: string;
  projectKey: string;
  authToken?: string;
  onAuthFailure?: () => Promise<string | undefined>;
}) {
  const dataSource = new HttpHarnessDataSource(config);
  const [state, setState] = createStore<BetterHarnessState>(initial);

  async function checkAvailability() {
    const avail = await dataSource.availability();
    setState("available", avail.available);
    setState("availableReason", avail.reason);
    return avail.available;
  }

  async function loadReport() {
    setState("loading", true);
    setState("error", undefined);
    try {
      const [report, history] = await Promise.all([
        dataSource.getReport(),
        dataSource.getHistory(),
      ]);
      setState("report", report);
      setState("history", history);
    } catch (err) {
      setState("error", err instanceof Error ? err.message : "Failed to load report");
    } finally {
      setState("loading", false);
    }
  }

  async function regenerate() {
    setState("error", undefined);
    try {
      const result = await dataSource.regenerate();
      if (result.accepted && result.runId) {
        setState("running", true);
        setState("runProgress", {
          runId: result.runId,
          status: "queued",
          progressPercent: 0,
        });
        // Poll for completion
        pollRun(result.runId);
      }
    } catch (err) {
      setState("error", err instanceof Error ? err.message : "Failed to start run");
    }
  }

  let pollingTimer: ReturnType<typeof setInterval> | null = null;

  async function pollRun(runId: string) {
    const poll = async () => {
      try {
        const progress = await dataSource.getRunProgress(runId);
        if (progress) {
          setState("runProgress", progress);
          if (["completed", "failed", "cancelled"].includes(progress.status)) {
            setState("running", false);
            if (pollingTimer) clearInterval(pollingTimer);
            pollingTimer = null;
            // Reload report after completion
            await loadReport();
          }
        }
      } catch {
        // Continue polling on error
      }
    };
    // Initial fetch
    await poll();
    // Then poll every 2s
    pollingTimer = setInterval(poll, 2_000);
  }

  async function cancelRun() {
    try {
      await dataSource.cancel();
      setState("running", false);
    } catch (err) {
      setState("error", err instanceof Error ? err.message : "Cancellation failed");
    }
  }

  async function planFix(findingId: string) {
    try {
      return await dataSource.planFix(findingId);
    } catch (err) {
      setState("error", err instanceof Error ? err.message : "Plan Fix failed");
      return { accepted: false };
    }
  }

  onCleanup(() => {
    if (pollingTimer) clearInterval(pollingTimer);
  });

  return {
    state,
    checkAvailability,
    loadReport,
    regenerate,
    cancelRun,
    planFix,
    dataSource,
  };
}
