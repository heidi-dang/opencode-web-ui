/**
 * Network Bandwidth Throttling Adaptation
 */

export interface NetworkAdaptiveOptions {
  effectiveType?: "slow-2g" | "2g" | "3g" | "4g";
  saveData?: boolean;
  rtt?: number;
  downlink?: number;
}

export function getNetworkAdaptation(): {
  effectiveType: string;
  isLowBandwidth: boolean;
  pollingIntervalMultiplier: number;
  disableNonEssentialTransitions: boolean;
} {
  if (typeof navigator === "undefined") {
    return {
      effectiveType: "4g",
      isLowBandwidth: false,
      pollingIntervalMultiplier: 1,
      disableNonEssentialTransitions: false,
    };
  }

  const conn = (navigator as unknown as { connection?: NetworkAdaptiveOptions }).connection;
  const effectiveType = conn?.effectiveType ?? "4g";
  const saveData = conn?.saveData ?? false;

  const isLowBandwidth = saveData || effectiveType === "2g" || effectiveType === "slow-2g";
  const pollingIntervalMultiplier = isLowBandwidth ? 3 : effectiveType === "3g" ? 1.5 : 1;

  return {
    effectiveType,
    isLowBandwidth,
    pollingIntervalMultiplier,
    disableNonEssentialTransitions: isLowBandwidth,
  };
}

/**
 * Fetch Priority Helper (Fix 359)
 */
export type FetchPriorityOption = "high" | "low" | "auto";

export function getFetchPriorityInit(priority: FetchPriorityOption = "auto"): RequestInit {
  return { priority } as RequestInit;
}
