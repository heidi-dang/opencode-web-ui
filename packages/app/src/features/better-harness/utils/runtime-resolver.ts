/**
 * Runtime resolver for FlowDeck Better Harness capability discovery.
 * Uses the state-backed /discovery endpoint when available.
 * No hardcoded hosts, ports, or filesystem paths.
 */
import { z } from "zod";

export const DiscoveryResponseSchema = z.object({
  available: z.boolean(),
  enabled: z.boolean(),
  state: z.enum(["starting", "running", "stopping", "stopped", "failed", "unknown"]),
  contractVersion: z.string(),
  schemaVersion: z.number(),
  serverKey: z.string(),
  projectKey: z.string(),
  authRequired: z.boolean(),
  capabilities: z.array(z.string()).optional(),
  startedAt: z.string().optional(),
  reason: z.string().optional(),
}).strict();

export type DiscoveryResponse = z.infer<typeof DiscoveryResponseSchema>;

export interface BetterHarnessRuntimeInfo {
  available: boolean;
  state: string;
  contractVersion: string;
  schemaVersion: number;
  serverKey: string;
  projectKey: string;
  authRequired: boolean;
  reason?: string;
}

/**
 * Discover Better Harness runtime info from the current server context.
 * Uses the state-backed /discovery endpoint first, falls back to /availability.
 */
export async function discoverBetterHarness(
  transportUrl: string,
  serverKey: string,
  projectKey: string,
  authToken?: string,
): Promise<BetterHarnessRuntimeInfo> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const baseUrl = transportUrl.replace(/\/+$/, "");
  const apiPath = `/api/v1/servers/${encodeURIComponent(serverKey)}/projects/${encodeURIComponent(projectKey)}/better-harness`;

  // Try the discovery endpoint first (state-backed with contract/schema versions)
  try {
    const res = await fetch(`${baseUrl}${apiPath}/discovery`, {
      method: "GET", headers, signal: AbortSignal.timeout(5_000),
    });
    if (res.status === 200) {
      const body: unknown = await res.json();
      const parsed = DiscoveryResponseSchema.safeParse(body);
      if (parsed.success) {
        return {
          available: parsed.data.available,
          state: parsed.data.state,
          contractVersion: parsed.data.contractVersion,
          schemaVersion: parsed.data.schemaVersion,
          serverKey: parsed.data.serverKey,
          projectKey: parsed.data.projectKey,
          authRequired: parsed.data.authRequired,
          reason: parsed.data.reason,
        };
      }
    }
  } catch { /* fall through */ }

  // Fallback to availability endpoint
  try {
    const res = await fetch(`${baseUrl}${apiPath}/availability`, {
      method: "GET", headers, signal: AbortSignal.timeout(5_000),
    });
    if (res.status === 200) {
      const body: unknown = await res.json();
      const available = (body as Record<string, unknown>)?.available === true;
      return { available, state: available ? "running" : "stopped", contractVersion: "", schemaVersion: 0, serverKey, projectKey, authRequired: !authToken };
    }
  } catch { /* fall through */ }

  return { available: false, state: "unavailable", contractVersion: "", schemaVersion: 0, serverKey, projectKey, authRequired: false };
}
