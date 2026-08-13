/**
 * Better Harness API data source.
 * Validates all responses with Zod, handles auth refresh, and provides
 * typed methods for all endpoints.
 */
import {
  validateAvailabilityResponse,
  validateStartRunResponse,
  validateCancelResponse,
  validatePlanFixResponse,
  validateVerifyResponse,
  validateIgnoreResponse,
} from "../schemas/harness-api";
import type { HarnessReport, HarnessRunProgress } from "../types";
import { 
  HarnessRunProgressSchema, 
  HarnessReportSchema, 
  HarnessHistorySchema 
} from "../schemas/harness-api";

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
}

export type ValidatedHttpResult<T> =
  | { kind: "value"; value: T }
  | { kind: "empty"; status: 204 | 404 };

export interface HarnessDataSource {
  availability(retryOpts?: RetryOptions): Promise<{ available: boolean; reason?: string }>;
  getReport(retryOpts?: RetryOptions): Promise<HarnessReport | undefined>;
  getHistory(retryOpts?: RetryOptions): Promise<HarnessReport[]>;
  getRunProgress(runId?: string, retryOpts?: RetryOptions): Promise<HarnessRunProgress | undefined>;
  regenerate(retryOpts?: RetryOptions): Promise<{ accepted: boolean; runId?: string }>;
  cancel(retryOpts?: RetryOptions): Promise<void>;
  planFix(findingId: string, retryOpts?: RetryOptions): Promise<{ accepted: boolean; opencodeSessionId?: string }>;
  verify(findingId: string, retryOpts?: RetryOptions): Promise<{ accepted: boolean }>;
  ignore(findingId: string, reason: string, retryOpts?: RetryOptions): Promise<{ accepted: boolean }>;

  getSseUrl(runId: string): string;
  getAuthHeaders(): Record<string, string>;
  refreshAuthToken(): Promise<string | undefined>;
}

export class HttpHarnessDataSource implements HarnessDataSource {
  private baseUrl: string;
  private serverKey: string;
  private projectKey: string;
  private authToken?: string;
  private onAuthFailure?: () => Promise<string | undefined>;
  private currentRunId?: string;
  private authRefreshInFlight: Promise<string | undefined> | null = null;
  private runAbortController: AbortController | null = null;

  constructor(config: {
    baseUrl: string;
    serverKey: string;
    projectKey: string;
    authToken?: string;
    onAuthFailure?: () => Promise<string | undefined>;
  }) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.serverKey = config.serverKey;
    this.projectKey = config.projectKey;
    this.authToken = config.authToken;
    this.onAuthFailure = config.onAuthFailure;
  }

  getSseUrl(runId: string): string {
    return `${this.apiBase}/runs/${encodeURIComponent(runId)}/events`;
  }

  getAuthHeaders(): Record<string, string> {
    return this.getHeaders();
  }

  async refreshAuthToken(): Promise<string | undefined> {
    const newToken = await this.refreshAuth();
    if (newToken) {
      this.authToken = newToken;
    }
    return newToken;
  }

  private get apiBase(): string {
    return `${this.baseUrl}/api/v1/servers/${encodeURIComponent(this.serverKey)}/projects/${encodeURIComponent(this.projectKey)}/better-harness`;
  }

  private getHeaders(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.authToken) h["Authorization"] = `Bearer ${this.authToken}`;
    return h;
  }

  private async validatedRequest<T>(
    method: string,
    path: string,
    validate: (data: unknown) => { valid: true; value: T } | { valid: false; error: string },
    body?: unknown,
    signal?: AbortSignal,
    isRetry?: boolean,
    retryOpts: RetryOptions = {},
  ): Promise<ValidatedHttpResult<T>> {
    const { maxRetries = 2, initialDelayMs = 200 } = retryOpts;
    const url = `${this.apiBase}${path}`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0 && lastError) {
        const delay = initialDelayMs * Math.pow(2, attempt - 1);
        await new Promise((res) => setTimeout(res, delay));
      }

      try {
        const res = await fetch(url, {
          method,
          headers: this.getHeaders(),
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal,
        });

        if (res.status === 204) return { kind: "empty", status: 204 };
        if (res.status === 404) return { kind: "empty", status: 404 };

        if ((res.status === 401 || res.status === 403) && this.onAuthFailure && !isRetry) {
          const newToken = await this.refreshAuthToken();
          if (newToken) {
            return this.validatedRequest(method, path, validate, body, signal, true, retryOpts);
          }
        }

        // Retry 5xx server errors
        if (res.status >= 500 && attempt < maxRetries) {
          const text = await res.text().catch(() => "");
          lastError = new Error(`Harness API error (${res.status}): ${text || res.statusText}`);
          continue;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Harness API error (${res.status}): ${text || res.statusText}`);
        }

        const json: unknown = await res.json();
        const validation = validate(json);
        if (!validation.valid) {
          throw new Error(`Harness API schema error: ${validation.error}`);
        }
        return { kind: "value", value: validation.value };
      } catch (err) {
        if ((err as Error).name === "AbortError") throw err;
        lastError = err as Error;
        if (attempt < maxRetries && lastError.message.startsWith("Harness API error (5")) {
          continue;
        }
        if (attempt === maxRetries || !isTransientNetworkError(lastError)) {
          throw lastError;
        }
      }
    }

    throw lastError || new Error("Request failed after retries");
  }

  private async refreshAuth(): Promise<string | undefined> {
    if (!this.onAuthFailure) return undefined;
    if (!this.authRefreshInFlight) {
      this.authRefreshInFlight = this.onAuthFailure().finally(() => {
        this.authRefreshInFlight = null;
      });
    }
    return this.authRefreshInFlight;
  }

  async availability(retryOpts?: RetryOptions): Promise<{ available: boolean; reason?: string }> {
    try {
      const result = await this.validatedRequest("GET", "/availability", validateAvailabilityResponse, undefined, undefined, false, retryOpts);
      if (result.kind === "empty") return { available: false, reason: "No availability response" };
      return result.value;
    } catch (err) {
      return { available: false, reason: err instanceof Error ? err.message : "Failed to check availability" };
    }
  }

  async getReport(retryOpts?: RetryOptions): Promise<HarnessReport | undefined> {
    const result = await this.validatedRequest("GET", "/report", (data) => {
      const r = HarnessReportSchema.safeParse(data);
      return r.success ? { valid: true, value: r.data as unknown as HarnessReport } : { valid: false, error: r.error.message };
    }, undefined, undefined, false, retryOpts);
    if (result.kind === "empty") return undefined;
    return result.value;
  }

  async getHistory(retryOpts?: RetryOptions): Promise<HarnessReport[]> {
    const result = await this.validatedRequest("GET", "/history", (data) => {
      const r = HarnessHistorySchema.safeParse(data);
      return r.success ? { valid: true, value: r.data as unknown as HarnessReport[] } : { valid: false, error: r.error.message };
    }, undefined, undefined, false, retryOpts);
    if (result.kind === "empty") return [];
    return result.value;
  }

  async getRunProgress(runId?: string, retryOpts?: RetryOptions): Promise<HarnessRunProgress | undefined> {
    const path = runId ? `/runs/${encodeURIComponent(runId)}` : "/runs/current";
    const result = await this.validatedRequest("GET", path, (data) => {
      const r = HarnessRunProgressSchema.safeParse(data);
      if (r.success) return { valid: true, value: r.data as unknown as HarnessRunProgress };
      return { valid: false, error: r.error.message };
    }, undefined, undefined, false, retryOpts);
    if (result.kind === "empty") return undefined;
    return result.value;
  }

  async regenerate(retryOpts?: RetryOptions): Promise<{ accepted: boolean; runId?: string }> {
    this.runAbortController = new AbortController();
    try {
      const result = await this.validatedRequest(
        "POST", "/runs", validateStartRunResponse,
        { mode: "full", sourceRevision: "current", collectors: ["customization", "sessions", "foundations"] },
        this.runAbortController.signal,
        false,
        retryOpts,
      );
      if (result.kind === "empty") throw new Error("Regeneration returned empty");
      if (result.value.accepted && result.value.runId) {
        this.currentRunId = result.value.runId;
      }
      return { accepted: result.value.accepted, runId: result.value.runId };
    } catch (err) {
      if ((err as Error).name === "AbortError") return { accepted: false };
      throw err;
    }
  }

  async planFix(findingId: string, retryOpts?: RetryOptions): Promise<{ accepted: boolean; opencodeSessionId?: string }> {
    const result = await this.validatedRequest("POST", "/findings/plan-fix", validatePlanFixResponse, {
      findingIds: [findingId],
    }, undefined, false, retryOpts);
    if (result.kind === "empty") throw new Error("Plan-fix response empty");
    const r = result.value.results?.[0];
    if (r?.accepted) return { accepted: true, opencodeSessionId: r.opencodeSessionId };
    return { accepted: false };
  }

  async cancel(retryOpts?: RetryOptions): Promise<void> {
    if (!this.currentRunId) return;
    const result = await this.validatedRequest(
      "POST", `/runs/${encodeURIComponent(this.currentRunId)}/cancel`, validateCancelResponse,
      undefined, undefined, false, retryOpts,
    );
    if (result.kind === "empty") throw new Error("Cancel response empty — cancellation not confirmed");
    if (this.runAbortController) {
      this.runAbortController.abort();
      this.runAbortController = null;
    }
    this.currentRunId = undefined;
  }

  async verify(findingId: string, retryOpts?: RetryOptions): Promise<{ accepted: boolean }> {
    const result = await this.validatedRequest("POST", "/findings/verify", validateVerifyResponse, {
      findingIds: [findingId],
    }, undefined, false, retryOpts);
    if (result.kind === "empty") throw new Error("Verify response empty");
    const item = result.value.results?.[0];
    return { accepted: item?.accepted === true };
  }

  async ignore(findingId: string, reason: string, retryOpts?: RetryOptions): Promise<{ accepted: boolean }> {
    const result = await this.validatedRequest("POST", "/findings/ignore", validateIgnoreResponse, {
      findingIds: [findingId],
      reason,
    }, undefined, false, retryOpts);
    if (result.kind === "empty") throw new Error("Ignore response empty");
    const item = result.value.results?.[0];
    return { accepted: item?.accepted === true };
  }
}

function isTransientNetworkError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return (
    msg.includes("network") ||
    msg.includes("failed to fetch") ||
    msg.includes("timeout") ||
    msg.includes("econnreset")
  );
}
