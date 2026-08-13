/**
 * SolidJS store for Better Harness — full lifecycle with SSE and polling.
 */
import { createStore, produce } from "solid-js/store";
import { createSignal, onCleanup } from "solid-js";
import { HttpHarnessDataSource } from "../api/harness-data-source";
import { SseParser, type SseFrame } from "../utils/sse-parser";
import type { HarnessReport, HarnessRunProgress } from "../types";

export interface BetterHarnessState {
  available: boolean;
  availableReason?: string;
  report?: HarnessReport;
  history: HarnessReport[];
  runProgress?: HarnessRunProgress;
  runId?: string;
  running: boolean;
  loading: boolean;
  error?: string;
  connected: boolean;
  sseFailed: boolean;
  pollWarning: boolean;
}

const initial: BetterHarnessState = {
  available: false,
  history: [],
  running: false,
  loading: false,
  connected: false,
  sseFailed: false,
  pollWarning: false,
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
  const parser = new SseParser();
  let sseAbort: AbortController | null = null;
  let pollingTimer: ReturnType<typeof setTimeout> | null = null;
  let pollErrorCount = 0;
  const MAX_POLL_ERRORS = 5;
  let lastValidEventId: string | undefined;
  let unmounted = false;

  onCleanup(() => {
    unmounted = true;
    cleanupSSE();
    clearPolling();
  });

  function cleanupSSE() {
    if (sseAbort) {
      sseAbort.abort();
      sseAbort = null;
    }
    parser.reset();
    setState("connected", false);
  }

  function clearPolling() {
    if (pollingTimer) {
      clearTimeout(pollingTimer);
      pollingTimer = null;
    }
    pollErrorCount = 0;
    setState("pollWarning", false);
  }

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
    setState("sseFailed", false);
    setState("pollWarning", false);
    clearPolling();
    cleanupSSE();

    try {
      const result = await dataSource.regenerate();
      if (result.accepted && result.runId) {
        setState("running", true);
        setState("runId", result.runId);
        setState("runProgress", {
          runId: result.runId,
          status: "queued",
          progressPercent: 0,
        });
        lastValidEventId = undefined;
        connectSSE(result.runId);
      }
    } catch (err) {
      setState("error", err instanceof Error ? err.message : "Failed to start run");
    }
  }

  async function connectSSE(runId: string, reconnectAttempts = 0) {
    if (unmounted) return;
    cleanupSSE();

    const MAX_SSE_RECONNECTS = 2;
    const abortController = new AbortController();
    sseAbort = abortController;
    const signal = abortController.signal;
    parser.reset();

    const url = dataSource.getSseUrl(runId);

    try {
      const headers: Record<string, string> = {
        Accept: "text/event-stream",
        ...dataSource.getAuthHeaders(),
      };
      if (lastValidEventId) headers["Last-Event-ID"] = lastValidEventId;

      const response = await fetch(url, { headers, signal });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          const newToken = await dataSource.refreshAuthToken();
          if (newToken && reconnectAttempts < MAX_SSE_RECONNECTS) {
            return connectSSE(runId, reconnectAttempts + 1);
          }
        }
        throw new Error(`SSE connection failed: ${response.status}`);
      }

      setState("connected", true);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("SSE body not readable");

      const decoder = new TextDecoder();
      let authAttempt = 1;

      const readLoop = async () => {
        try {
          while (!signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value, { stream: true });
            parser.feed(text, (frame) => {
              processFrame(frame, runId);
            });
          }
          decoder.decode(); // flush
          return authAttempt === 1;
        } catch (err) {
          if (signal.aborted) return false;

          // Auth retry (one attempt)
          if (authAttempt === 1) {
            const msg = (err as Error).message || "";
            if (msg.includes("401") || msg.includes("403")) {
              try {
                const newToken = await dataSource.refreshAuthToken();
                if (newToken && !signal.aborted && reconnectAttempts < MAX_SSE_RECONNECTS) {
                  authAttempt = 2;
                  return connectSSE(runId, reconnectAttempts + 1);
                }
              } catch { /* fall through */ }
            }
          }

          // Bounded reconnect attempt before polling fallback
          if (reconnectAttempts < MAX_SSE_RECONNECTS && !signal.aborted) {
            const backoffDelay = Math.pow(2, reconnectAttempts) * 500;
            await new Promise((res) => setTimeout(res, backoffDelay));
            if (!signal.aborted && !unmounted) {
              return connectSSE(runId, reconnectAttempts + 1);
            }
          }

          // SSE failed — start polling fallback
          setState("sseFailed", true);
          startPolling(runId);
          return false;
        } finally {
          try {
            reader.releaseLock();
          } catch { /* ignore */ }
        }
      };

      readLoop();
    } catch {
      if (!signal.aborted) {
        if (reconnectAttempts < MAX_SSE_RECONNECTS && !unmounted) {
          const backoffDelay = Math.pow(2, reconnectAttempts) * 500;
          await new Promise((res) => setTimeout(res, backoffDelay));
          if (!signal.aborted && !unmounted) {
            return connectSSE(runId, reconnectAttempts + 1);
          }
        }
        setState("sseFailed", true);
        startPolling(runId);
      }
    }
  }

  function processFrame(frame: SseFrame, runId: string) {
    // Connected and heartbeat frames must NOT advance lastValidEventId
    if (frame.event === "connected" || frame.event === "heartbeat") return;

    // Validate envelope JSON
    const rawData = frame.data.join("\n");
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawData);
    } catch { return; }

    const envelope = parsed as Record<string, unknown>;
    if (envelope.type !== frame.event) return;

    // Cross-run event rejection
    const payloadData = envelope.data as Record<string, unknown> | undefined;
    if (payloadData?.runId && payloadData.runId !== runId) return;

    // Update replay watermark from durable events only
    if (frame.id) {
      const idNum = parseInt(frame.id, 10);
      const lastNum = lastValidEventId ? parseInt(lastValidEventId, 10) : -1;
      if (!isNaN(idNum) && idNum <= lastNum) return; // stale
      lastValidEventId = frame.id;
    }

    // Map to consumer events
    if (envelope.type === "run.progress") {
      setState("runProgress", {
        runId: payloadData?.runId as string || runId,
        status: payloadData?.status as HarnessRunProgress["status"] || "running",
        progressPercent: payloadData?.progressPercent as number || 0,
        stage: payloadData?.stage as string,
        errorMessage: payloadData?.errorMessage as string,
      });
    } else if (["report.completed", "run.failed", "run.cancelled"].includes(envelope.type as string)) {
      setState("running", false);
      cleanupSSE();
      clearPolling();
      loadReport();
    }
  }

  async function startPolling(runId: string) {
    if (unmounted || pollErrorCount >= MAX_POLL_ERRORS) return;

    try {
      const progress = await dataSource.getRunProgress(runId);
      if (progress) {
        setState("runProgress", progress);
        pollErrorCount = 0;
        setState("pollWarning", false);

        if (["completed", "failed", "cancelled"].includes(progress.status)) {
          setState("running", false);
          clearPolling();
          await loadReport();
          return;
        }
      }
    } catch {
      pollErrorCount++;
      if (pollErrorCount >= MAX_POLL_ERRORS) {
        setState("pollWarning", true);
        setState("error", "Analysis progress unavailable. Check the server.");
        clearPolling();
        return;
      }
    }

    // Schedule next poll only after current resolves (no overlap)
    if (!unmounted && pollingTimer === null) {
      pollingTimer = setTimeout(() => {
        pollingTimer = null;
        startPolling(runId);
      }, 2_000);
    }
  }

  async function cancelRun() {
    try {
      await dataSource.cancel();
      setState("running", false);
      cleanupSSE();
      clearPolling();
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

  async function verify(findingId: string) {
    try {
      return await dataSource.verify(findingId);
    } catch (err) {
      setState("error", err instanceof Error ? err.message : "Verification failed");
      return { accepted: false };
    }
  }

  async function ignore(findingId: string, reason: string) {
    try {
      return await dataSource.ignore(findingId, reason);
    } catch (err) {
      setState("error", err instanceof Error ? err.message : "Failed to ignore");
      return { accepted: false };
    }
  }

  return {
    state,
    checkAvailability,
    loadReport,
    regenerate,
    cancelRun,
    planFix,
    verify,
    ignore,
    cleanupSSE,
    clearPolling,
    dataSource,
  };
}
