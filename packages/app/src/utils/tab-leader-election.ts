/**
 * Multi-Tab Leader Election using Web Locks API & BroadcastChannel fallback
 */

export interface LeaderElectionCallbacks {
  onElected: () => void;
  onSteppedDown?: () => void;
}

export class TabLeaderElection {
  private name: string;
  private isLeaderState = false;
  private channel?: BroadcastChannel;
  private abortController = new AbortController();

  constructor(name: string = "opencode-tab-leader") {
    this.name = name;
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(this.name);
    }
  }

  public get isLeader(): boolean {
    return this.isLeaderState;
  }

  public async startElection(callbacks: LeaderElectionCallbacks): Promise<void> {
    if (typeof navigator !== "undefined" && "locks" in navigator && navigator.locks) {
      try {
        await navigator.locks.request(
          this.name,
          { signal: this.abortController.signal },
          async () => {
            this.isLeaderState = true;
            callbacks.onElected();
            // Hold lock until aborted / tab closed
            return new Promise<void>((resolve) => {
              this.abortController.signal.addEventListener("abort", () => {
                this.isLeaderState = false;
                callbacks.onSteppedDown?.();
                resolve();
              });
            });
          }
        );
      } catch (err) {
        // Aborted or rejected
        this.isLeaderState = false;
      }
    } else {
      // Fallback: single tab leader assumption if Web Locks API is unavailable
      this.isLeaderState = true;
      callbacks.onElected();
    }
  }

  public stop(): void {
    this.abortController.abort();
    if (this.channel) {
      this.channel.close();
    }
    this.isLeaderState = false;
  }
}
