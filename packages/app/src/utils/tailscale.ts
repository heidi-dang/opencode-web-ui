export type TailscalePath = "DIRECT" | "DERP" | "UNKNOWN"

export type TailscaleDiagnostics = {
  path: TailscalePath
  hostname?: string
  reason: "tailnet-host" | "non-tailnet-host" | "unavailable"
}

export function classifyTailscaleServer(serverUrl: string): TailscaleDiagnostics {
  try {
    const hostname = new URL(serverUrl).hostname.toLowerCase()
    if (hostname.endsWith(".ts.net")) {
      return { path: "UNKNOWN", hostname, reason: "tailnet-host" }
    }
    return { path: "UNKNOWN", hostname, reason: "non-tailnet-host" }
  } catch {
    return { path: "UNKNOWN", reason: "unavailable" }
  }
}
