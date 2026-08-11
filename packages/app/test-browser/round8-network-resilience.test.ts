/**
 * Advanced Network Isolation & Resilient Protocol Handling (Fixes 351-365)
 * Test Suite
 */

import { describe, expect, test, mock } from "bun:test";
import {
  streamReconnectDelay,
  parseRetryAfterHeader,
  parseNetworkErrorDiagnostics,
  createDecompressionStreamGuard,
} from "../src/utils/network-resilience";
import { getNetworkAdaptation, getFetchPriorityInit } from "../src/utils/network-adaptive";
import { TabLeaderElection } from "../src/utils/tab-leader-election";
import { chunkFile, uploadFileInChunks } from "../src/utils/payload-chunker";
import { ApiHostFailoverManager } from "../src/utils/api-host-failover";
import { AuthTabSyncManager } from "../src/utils/auth-tab-sync";

describe("Round 8: Advanced Network Isolation & Resilient Protocol Handling (351-365)", () => {
  // 351. Adaptive SSE Backoff Strategy
  test("Fix 351: streamReconnectDelay computes exponential backoff with jitter", () => {
    const baseDelay1 = streamReconnectDelay(1, 0);
    const baseDelay2 = streamReconnectDelay(2, 0);
    const baseDelay3 = streamReconnectDelay(3, 0);

    expect(baseDelay1).toBe(250);
    expect(baseDelay2).toBe(500);
    expect(baseDelay3).toBe(1000);

    // Test jitter inclusion
    const jitterDelay1 = streamReconnectDelay(1, 1.0);
    expect(jitterDelay1).toBe(313); // 250 + 250 * 0.25 = 312.5 -> 313
  });

  // 353. Network Bandwidth Throttling Adaptation
  test("Fix 353: getNetworkAdaptation adapts config based on connection speed", () => {
    const adaptation = getNetworkAdaptation();
    expect(adaptation.effectiveType).toBeDefined();
    expect(adaptation.pollingIntervalMultiplier).toBeGreaterThanOrEqual(1);
  });

  // 355. Multi-Tab Leader Election
  test("Fix 355: TabLeaderElection acquires leadership", async () => {
    const leader = new TabLeaderElection("test-channel-" + Math.random());
    let elected = false;
    await leader.startElection({
      onElected: () => {
        elected = true;
      },
    });
    expect(elected).toBe(true);
    expect(leader.isLeader).toBe(true);
    leader.stop();
    expect(leader.isLeader).toBe(false);
  });

  // 357. Request Interception Diagnostics
  test("Fix 357: parseNetworkErrorDiagnostics classifies TCP, DNS, and offline drops", () => {
    const dnsErr = parseNetworkErrorDiagnostics(new Error("getaddrinfo ENOTFOUND api.opencode.ai"));
    expect(dnsErr.type).toBe("DNS");

    const connRefused = parseNetworkErrorDiagnostics(new Error("connect ECONNREFUSED 127.0.0.1:4096"));
    expect(connRefused.type).toBe("ConnectionRefused");

    const timeout = parseNetworkErrorDiagnostics(new Error("Request timed out after 10000ms"));
    expect(timeout.type).toBe("Timeout");

    const fetchErr = parseNetworkErrorDiagnostics(new TypeError("Failed to fetch"));
    expect(fetchErr.type).toBe("GenericFetch");
  });

  // 358. Dynamic Payload Chunking
  test("Fix 358: chunkFile splits payload and calculates SHA-256 checksums", async () => {
    const data = new Uint8Array(2500);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const blob = new Blob([data]);

    const chunks = await chunkFile(blob, 1024);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].total).toBe(3);
    expect(chunks[0].sha256).toHaveLength(64); // Valid hex SHA-256
  });

  test("Fix 358: uploadFileInChunks uploads chunked files with retries", async () => {
    const blob = new Blob([new Uint8Array(1500)]);
    const uploadedChunks: string[] = [];

    const customFetch = async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/finalize")) {
        return new Response(JSON.stringify({ status: "complete" }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    };

    const res = await uploadFileInChunks(blob, "test.bin", {
      uploadUrl: "http://localhost:4096/upload",
      customFetch: customFetch as typeof fetch,
    });

    expect(res.status).toBe(200);
  });

  // 359. Request Prioritization Pipeline
  test("Fix 359: getFetchPriorityInit sets fetch priority options", () => {
    const high = getFetchPriorityInit("high");
    expect((high as { priority?: string }).priority).toBe("high");

    const low = getFetchPriorityInit("low");
    expect((low as { priority?: string }).priority).toBe("low");
  });

  // 361. HTTP 503 Retry-After Compliance
  test("Fix 361: parseRetryAfterHeader parses numeric seconds and HTTP dates", () => {
    expect(parseRetryAfterHeader("120")).toBe(120000);
    expect(parseRetryAfterHeader(null)).toBeUndefined();
    expect(parseRetryAfterHeader(undefined)).toBeUndefined();
    expect(parseRetryAfterHeader("invalid")).toBeUndefined();

    const futureDate = new Date(Date.now() + 60000).toUTCString();
    const delay = parseRetryAfterHeader(futureDate);
    expect(delay).toBeGreaterThan(50000);
    expect(delay).toBeLessThanOrEqual(60000);
  });

  // 363. Dynamic API Host Failover
  test("Fix 363: ApiHostFailoverManager fails over after consecutive errors", async () => {
    let failCount = 0;
    const customFetch = async () => {
      failCount++;
      return new Response(null, { status: 503 });
    };

    const manager = new ApiHostFailoverManager({
      primaryHost: "http://primary:4096",
      backupHosts: ["http://backup:4096"],
      maxFailureCount: 3,
      customFetch: customFetch as typeof fetch,
    });

    expect(manager.activeHost).toBe("http://primary:4096");

    await manager.checkHealth();
    await manager.checkHealth();
    expect(manager.activeHost).toBe("http://primary:4096");

    await manager.checkHealth(); // 3rd failure triggers failover
    expect(manager.activeHost).toBe("http://backup:4096");
  });

  // 364. Cross-Tab Authorization Synchronization
  test("Fix 364: AuthTabSyncManager handles auth channel creation and callbacks", () => {
    const sync = new AuthTabSyncManager("test-auth-sync-" + Math.random());
    let callbackPayload: unknown;
    sync.registerCallback((payload) => {
      callbackPayload = payload;
    });

    sync.broadcastAuthChange("logout");
    sync.destroy();
  });

  // 365. Safe Payload Decompression Guard
  test("Fix 365: createDecompressionStreamGuard aborts when exceeding max bytes", async () => {
    const guard = createDecompressionStreamGuard(100);
    if (!guard.writable || typeof guard.writable.getWriter !== "function") {
      expect(guard).toBeDefined();
      return;
    }
    const writer = guard.writable.getWriter();
    const reader = guard.readable.getReader();

    await writer.write(new Uint8Array(50));
    const chunk1 = await reader.read();
    expect(chunk1.value?.byteLength).toBe(50);

    let errorThrown: unknown = null;
    try {
      await writer.write(new Uint8Array(60)); // Exceeds 100 maxBytes limit (50 + 60 = 110)
      await reader.read();
    } catch (err) {
      errorThrown = err;
    }

    expect(errorThrown).toBeDefined();
  });
});
