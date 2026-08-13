import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { HttpHarnessDataSource } from "../api/harness-data-source";

describe("HttpHarnessDataSource", () => {
  let dataSource: HttpHarnessDataSource;
  const originalFetch = globalThis.fetch;
  const mockFetch = mock();

  beforeEach(() => {
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
    dataSource = new HttpHarnessDataSource({
      baseUrl: "http://localhost",
      serverKey: "test-server",
      projectKey: "test-project",
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mockFetch.mockReset();
  });

  it("handles 200 OK correctly", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ available: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    const res = await dataSource.availability();
    expect(res).toEqual({ available: true });
  });

  it("handles 204 No Content correctly", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const res = await dataSource.getReport();
    expect(res).toBeUndefined();
  });

  it("handles 404 Not Found correctly", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const res = await dataSource.getRunProgress("test-run");
    expect(res).toBeUndefined();
  });

  it("handles 401 Unauthorized by attempting refresh if provided", async () => {
    const onAuthFailure = mock().mockResolvedValueOnce("new-token");
    const authDataSource = new HttpHarnessDataSource({
      baseUrl: "http://localhost",
      serverKey: "test-server",
      projectKey: "test-project",
      authToken: "old-token",
      onAuthFailure,
    });

    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ available: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));

    const res = await authDataSource.availability();
    expect(res).toEqual({ available: true });
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
  
  it("returns available false on 403 Forbidden if refresh fails", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
    const res = await dataSource.availability();
    expect(res.available).toBe(false);
    expect(res.reason).toMatch(/Harness API error/);
  });

  it("throws on 403 Forbidden if refresh fails for other methods", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(dataSource.getReport()).rejects.toThrow(/Harness API error/);
  });

  it("rejects malformed responses instead of swallowing them", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ runId: "123", status: "invalid-status" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    await expect(dataSource.getRunProgress("123")).rejects.toThrow(/Harness API schema error/);
  });

  it("automatically retries transient 5xx errors with exponential backoff", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Service Unavailable" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ available: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    const res = await dataSource.availability({ maxRetries: 2, initialDelayMs: 10 });
    expect(res).toEqual({ available: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("exposes public SSE contract methods cleanly without private bracket-access", async () => {
    const onAuthFailure = mock().mockResolvedValueOnce("refreshed-token");
    const authDs = new HttpHarnessDataSource({
      baseUrl: "http://localhost:8080/",
      serverKey: "srv1",
      projectKey: "proj1",
      authToken: "token123",
      onAuthFailure,
    });

    expect(authDs.getSseUrl("run-abc")).toBe(
      "http://localhost:8080/api/v1/servers/srv1/projects/proj1/better-harness/runs/run-abc/events"
    );
    expect(authDs.getAuthHeaders()).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer token123",
    });

    const newTok = await authDs.refreshAuthToken();
    expect(newTok).toBe("refreshed-token");
    expect(authDs.getAuthHeaders().Authorization).toBe("Bearer refreshed-token");
  });

  it("strictly validates verify and ignore response schemas via Zod", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ accepted: true, results: [{ findingId: "f1", accepted: true }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const verifyRes = await dataSource.verify("f1");
    expect(verifyRes).toEqual({ accepted: true });

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ accepted: true, results: [{ findingId: "f1", accepted: true }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const ignoreRes = await dataSource.ignore("f1", "False positive");
    expect(ignoreRes).toEqual({ accepted: true });
  });
});
