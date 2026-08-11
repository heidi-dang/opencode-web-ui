/**
 * Dynamic API Host Failover Manager
 */

export interface HostFailoverConfig {
  primaryHost: string;
  backupHosts: string[];
  maxFailureCount?: number;
  healthCheckIntervalMs?: number;
  customFetch?: typeof fetch;
}

export class ApiHostFailoverManager {
  private primaryHost: string;
  private backupHosts: string[];
  private currentHost: string;
  private consecutiveFailures = 0;
  private maxFailureCount: number;
  private customFetch: typeof fetch;

  constructor(config: HostFailoverConfig) {
    this.primaryHost = config.primaryHost;
    this.backupHosts = config.backupHosts;
    this.currentHost = config.primaryHost;
    this.maxFailureCount = config.maxFailureCount ?? 3;
    this.customFetch = config.customFetch ?? fetch;
  }

  public get activeHost(): string {
    return this.currentHost;
  }

  public recordSuccess(): void {
    this.consecutiveFailures = 0;
    // If we are on backup host, attempt to return to primary on next periodic health check
  }

  public recordFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.maxFailureCount) {
      this.failover();
    }
  }

  private failover(): void {
    if (this.backupHosts.length === 0) return;

    if (this.currentHost === this.primaryHost) {
      this.currentHost = this.backupHosts[0];
    } else {
      const idx = this.backupHosts.indexOf(this.currentHost);
      const nextIdx = (idx + 1) % this.backupHosts.length;
      if (nextIdx === 0) {
        this.currentHost = this.primaryHost; // Loop back to primary to re-test
      } else {
        this.currentHost = this.backupHosts[nextIdx];
      }
    }
    this.consecutiveFailures = 0;
    console.warn(`[api-host-failover] Switched active API host to ${this.currentHost}`);
  }

  public async checkHealth(): Promise<boolean> {
    try {
      const healthUrl = new URL("/api/health", this.currentHost).toString();
      const res = await this.customFetch(healthUrl, { method: "GET" });
      if (res.ok) {
        this.recordSuccess();
        return true;
      }
      this.recordFailure();
      return false;
    } catch (err) {
      this.recordFailure();
      return false;
    }
  }
}
