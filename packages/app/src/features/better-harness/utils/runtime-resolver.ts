/**
 * Runtime resolver for FlowDeck Better Harness capability discovery.
 *
 * Discovers whether the current OpenCode server has FlowDeck loaded,
 * whether Better Harness is enabled, and what API endpoint to use.
 *
 * No hardcoded hosts, ports, or filesystem paths.
 */

export interface BetterHarnessRuntimeInfo {
  /** Whether FlowDeck Better Harness is available on this server. */
  available: boolean;
  /** The discovered API base URL for Better Harness endpoints. */
  apiBaseUrl: string;
  /** The opaque server key. */
  serverKey: string;
  /** The opaque project key. */
  projectKey: string;
  /** Whether authentication is required. */
  authRequired: boolean;
}

/**
 * Discover Better Harness runtime info from the current OpenCode server context.
 *
 * Strategy:
 *   1. Probe the server's location-scoped `/better-harness/availability` endpoint with timeout.
 *   2. Return availability status, API base URL, and auth requirement flags.
 *   3. Fall through to `available: false` if unreachable, unauthenticated, or returned 404.
 */
export async function discoverBetterHarness(
  transportUrl: string,
  serverKey: string,
  projectKey: string,
  authToken?: string,
): Promise<BetterHarnessRuntimeInfo> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  // Try the Better Harness availability endpoint
  const baseUrl = transportUrl.replace(/\/+$/, "");
  const apiPath = `/api/v1/servers/${encodeURIComponent(serverKey)}/projects/${encodeURIComponent(projectKey)}/better-harness`;

  try {
    const res = await fetch(`${baseUrl}${apiPath}/availability`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(5_000),
    });

    if (res.status === 200) {
      const body: unknown = await res.json();
      const available = (body as Record<string, unknown>)?.available === true;
      return {
        available,
        apiBaseUrl: baseUrl,
        serverKey,
        projectKey,
        authRequired: !authToken,
      };
    }

    if (res.status === 401 || res.status === 404) {
      // BH may be on a different path or not available
      return {
        available: false,
        apiBaseUrl: baseUrl,
        serverKey,
        projectKey,
        authRequired: res.status === 401,
      };
    }
  } catch {
    // Network error — BH not reachable
  }

  return {
    available: false,
    apiBaseUrl: baseUrl,
    serverKey,
    projectKey,
    authRequired: false,
  };
}
