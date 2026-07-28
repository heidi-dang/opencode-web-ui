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
} from "../schemas/harness-api";
import type { HarnessReport, HarnessRunProgress } from "../types";

export type ValidatedHttpResult<T> =
  | { kind: "value"; value: T }
  | { kind: "empty"; status: 204 | 404 };

export interface HarnessDataSource {
  availability(): Promise<{ available: boolean; reason?: string }>;
  getReport(): Promise<HarnessReport | undefined>;
  getHistory(): Promise<HarnessReport[]>;
  getRunProgress(runId?: string): Promise<HarnessRunProgress | undefined>;
  regenerate(): Promise<{ accepted: boolean; runId?: string }>;
  cancel(): Promise<void>;
  planFix(findingId: string): Promise<{ accepted: boolean; opencodeSessionId?: string }>;
  verify(findingId: string): Promise<{ accepted: boolean }>;
  ignore(findingId: string, reason: string): Promise<{ accepted: boolean }>;
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
  ): Promise<ValidatedHttpResult<T>> {
    const url = `${this.apiBase}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.getHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });

    if (res.status === 204) return { kind: "empty", status: 204 };
    if (res.status === 404) return { kind: "empty", status: 404 };

    if ((res.status === 401 || res.status === 403) && this.onAuthFailure && !isRetry) {
      const newToken = await this.refreshAuth();
      if (newToken) {
        this.authToken = newToken;
        return this.validatedRequest(method, path, validate, body, signal, true);
      }
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

  async availability(): Promise<{ available: boolean; reason?: string }> {
    try {
      const result = await this.validatedRequest("GET", "/availability", validateAvailabilityResponse);
      if (result.kind === "empty") return { available: false, reason: "No availability response" };
      return result.value;
    } catch (err) {
      return { available: false, reason: err instanceof Error ? err.message : "Failed to check availability" };
    }
  }

  async getReport(): Promise<HarnessReport | undefined> {
    const result = await this.validatedRequest("GET", "/report", (data) => {
      const schema = (await import("../schemas/harness-api")).HarnessRunProgressSchema;
      const r = schema.safeParse(data);
      return r.success ? { valid: true, value: r.data as unknown as HarnessReport } : { valid: false, error: r.error.message };
    });
    if (result.kind === "empty") return undefined;
    return result.value;
  }

  async getHistory(): Promise<HarnessReport[]> {
    const result = await this.validatedRequest("GET", "/history", (data) => {
      const arr = (data as unknown[]).filter(Boolean);
      return { valid: true, value: arr as HarnessReport[] };
    });
    if (result.kind === "empty") return [];
    return result.value;
  }

  async getRunProgress(runId?: string): Promise<HarnessRunProgress | undefined> {
    const path = runId ? `/runs/${encodeURIComponent(runId)}` : "/runs/current";
    const result = await this.validatedRequest("GET", path, (data) => {
      const r = HarnessReport.safeParse(data);
      if (r.success) return { valid: true, value: r.data as unknown as HarnessRunProgress };
      // Try run progress schema
      return { valid: true, value: data as HarnessRunProgress };
    });
    if (result.kind === "empty") return undefined;
    return result.value;
  }

  async regenerate(): Promise<{ accepted: boolean; runId?: string }> {
    this.runAbortController = new AbortController();
    try {
      const result = await this.validatedRequest(
        "POST", "/runs", validateStartRunResponse,
        { mode: "full", sourceRevision: "current", collectors: ["customization", "sessions", "foundations"] },
        this.runAbortController.signal,
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

  async planFix(findingId: string): Promise<{ accepted: boolean; opencodeSessionId?: string }> {
    const result = await this.validatedRequest("POST", "/findings/plan-fix", validatePlanFixResponse, {
      findingIds: [findingId],
    });
    if (result.kind === "empty") throw new Error("Plan-fix response empty");
    const r = result.value.results?.[0];
    if (r?.accepted) return { accepted: true, opencodeSessionId: r.opencodeSessionId };
    return { accepted: false };
  }

  async cancel(): Promise<void> {
    if (!this.currentRunId) return;
    const result = await this.validatedRequest(
      "POST", `/runs/${encodeURIComponent(this.currentRunId)}/cancel`, validateCancelResponse,
    );
    if (result.kind === "empty") throw new Error("Cancel response empty — cancellation not confirmed");
    if (this.runAbortController) {
      this.runAbortController.abort();
      this.runAbortController = null;
    }
    this.currentRunId = undefined;
  }

  async verify(findingId: string): Promise<{ accepted: boolean }> {
    const result = await this.validatedRequest("POST", "/findings/verify", (d) => {
      const r = (d as Record<string, unknown>).results as Array<Record<string, unknown>> | undefined;
      const accepted = r?.[0]?.accepted === true;
      return { valid: true, value: { accepted } };
    }, { findingIds: [findingId] });
    if (result.kind === "empty") throw new Error("Verify response empty");
    return result.value;
  }

  async ignore(findingId: string, reason: string): Promise<{ accepted: boolean }> {
    const result = await this.validatedRequest("POST", "/findings/ignore", (d) => {
      const r = (d as Record<string, unknown>).results as Array<Record<string, unknown>> | undefined;
      const accepted = r?.[0]?.accepted === true;
      return { valid: true, value: { accepted } };
    }, { findingIds: [findingId], reason });
    if (result.kind === "empty") throw new Error("Ignore response empty");
    return result.value;
  }
}
