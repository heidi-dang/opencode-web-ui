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
    // getRunProgress returns { valid: false, error: ... } inside its schema validation loop which maps to an error?
    // Wait, getRunProgress wraps with ValidatedRequest which throws on valid: false!
    await expect(dataSource.getRunProgress("123")).rejects.toThrow(/Harness API schema error/);
  });
});
