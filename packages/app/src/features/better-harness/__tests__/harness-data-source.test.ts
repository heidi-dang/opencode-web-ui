import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { HttpHarnessDataSource } from "../api/harness-data-source";

describe("HttpHarnessDataSource", () => {
  let dataSource: HttpHarnessDataSource;
  const originalFetch = globalThis.fetch;
  const mockFetch = mock();
  // Bun's fetch type requires a `preconnect` property; attach it to the mock
  // so assigning it to globalThis.fetch typechecks and behaves correctly.
  const fetchImpl = Object.assign(mockFetch, { preconnect: originalFetch.preconnect }) as typeof fetch;

  beforeEach(() => {
    globalThis.fetch = fetchImpl;
    dataSource = new HttpHarnessDataSource({
      baseUrl: "http://localhost",
      serverKey: "test-key",
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

  it("returns empty history on 204 No Content", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const res = await dataSource.getHistory();
    expect(res).toEqual([]);
  });

  it("handles 404 Not Found correctly", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const res = await dataSource.getRunProgress("test-run");
    expect(res).toBeUndefined();
  });

  it("sends Basic auth header when an auth token is provided", async () => {
    const authDataSource = new HttpHarnessDataSource({
      baseUrl: "http://localhost",
      serverKey: "test-key",
      projectKey: "test-project",
      authToken: "dXNlcjpwYXNz",
    });
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ available: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    await authDataSource.availability();
    const init = mockFetch.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Basic dXNlcjpwYXNz");
  });

  it("handles 401 Unauthorized by attempting refresh if provided", async () => {
    const onAuthFailure = mock().mockResolvedValueOnce("new-token");
    const authDataSource = new HttpHarnessDataSource({
      baseUrl: "http://localhost",
      serverKey: "test-key",
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

  it("uses the refreshed token on the retry request", async () => {
    const onAuthFailure = mock().mockResolvedValueOnce("new-token");
    const authDataSource = new HttpHarnessDataSource({
      baseUrl: "http://localhost",
      serverKey: "test-key",
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

    await authDataSource.availability();
    const init = mockFetch.mock.calls[1]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Basic new-token");
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

  it("rejects malformed report responses", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ overallScore: 999 }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    await expect(dataSource.getReport()).rejects.toThrow(/Harness API schema error/);
  });

  it("regenerate returns accepted and records the run id", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true, runId: "run_1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    const res = await dataSource.regenerate();
    expect(res).toEqual({ accepted: true, runId: "run_1" });
  });

  it("cancel aborts the current run", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true, runId: "run_1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    await dataSource.regenerate();

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    await dataSource.cancel();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("planFix returns the opencode session id when accepted", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      accepted: true,
      results: [{ findingId: "f1", accepted: true, opencodeSessionId: "ses_1" }]
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    const res = await dataSource.planFix("f1");
    expect(res).toEqual({ accepted: true, opencodeSessionId: "ses_1" });
  });

  it("verify returns accepted when the finding is verified", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      results: [{ findingId: "f1", accepted: true }]
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    const res = await dataSource.verify("f1");
    expect(res).toEqual({ accepted: true });
  });

  it("ignore returns accepted", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      results: [{ findingId: "f1", accepted: true }]
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    const res = await dataSource.ignore("f1", "reason");
    expect(res).toEqual({ accepted: true });
  });
});
