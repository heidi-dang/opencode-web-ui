/**
 * Network Resilience Utilities
 */

import { ClientError } from "@opencode-ai/client/promise";

/**
 * Computes a jittered exponential backoff delay to prevent thundering herd.
 * Base delay starts at 250ms, doubles with each retry up to 5000ms max.
 * Applies a 0-25% random jitter.
 */
export function streamReconnectDelay(failures: number, jitterSeed = Math.random()): number {
  const base = Math.min(5000, 250 * 2 ** Math.max(0, failures - 1));
  const jitter = base * 0.25 * jitterSeed;
  return Math.round(base + jitter);
}

/**
 * Parses HTTP 503 Retry-After headers (either seconds or an HTTP-date).
 * Returns the delay in milliseconds, or undefined if invalid or missing.
 */
export function parseRetryAfterHeader(headerValue: string | null | undefined): number | undefined {
  if (!headerValue) return undefined;
  // If it's a number of seconds
  if (/^\d+$/.test(headerValue)) {
    const seconds = parseInt(headerValue, 10);
    return isNaN(seconds) ? undefined : seconds * 1000;
  }
  // Otherwise, parse as HTTP date
  const parsedDate = Date.parse(headerValue);
  if (!isNaN(parsedDate)) {
    const delay = parsedDate - Date.now();
    return delay > 0 ? delay : 0;
  }
  return undefined;
}

/**
 * Parses a generic network fetch/DNS/TCP drop error into clear user-facing diagnostics.
 */
export interface NetworkDiagnostics {
  type: "Offline" | "DNS" | "ConnectionRefused" | "Timeout" | "GenericFetch" | "Unknown";
  message: string;
  isRecoverable: boolean;
}

export function parseNetworkErrorDiagnostics(error: unknown): NetworkDiagnostics {
  const msg = String(error instanceof Error ? error.message : error).toLowerCase();

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      type: "Offline",
      message: "Network is offline. Please check your internet connection.",
      isRecoverable: true,
    };
  }

  if (msg.includes("dns") || msg.includes("eai_again") || msg.includes("enotfound") || msg.includes("cannot resolve")) {
    return {
      type: "DNS",
      message: "DNS lookup failed. The server host could not be resolved.",
      isRecoverable: true,
    };
  }

  if (msg.includes("refused") || msg.includes("econnrefused") || msg.includes("connection refused")) {
    return {
      type: "ConnectionRefused",
      message: "Connection refused. The server might be down or unreachable.",
      isRecoverable: true,
    };
  }

  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("etimedout")) {
    return {
      type: "Timeout",
      message: "Request timed out. The server took too long to respond.",
      isRecoverable: true,
    };
  }

  if (msg.includes("fetch") || msg.includes("networkerror") || error instanceof TypeError) {
    return {
      type: "GenericFetch",
      message: "Network fetch failed. A network-level error occurred.",
      isRecoverable: true,
    };
  }

  return {
    type: "Unknown",
    message: error instanceof Error ? error.message : String(error),
    isRecoverable: true,
  };
}

/**
 * Capped TransformStream to limit decompressed size to prevent zip-bomb attacks.
 */
export function createDecompressionStreamGuard(maxBytes: number = 50 * 1024 * 1024) {
  let bytesWritten = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytesWritten += chunk.byteLength;
      if (bytesWritten > maxBytes) {
        controller.error(new Error(`Decompression limit exceeded: size exceeds maximum safe limit of ${maxBytes} bytes.`));
        return;
      }
      controller.enqueue(chunk);
    }
  });
}
