/**
 * Cross-Tab Authorization Synchronization via BroadcastChannel
 */

export interface AuthSyncPayload {
  action: "login" | "logout" | "token_refresh";
  token?: string;
  timestamp: number;
}

export class AuthTabSyncManager {
  private channel?: BroadcastChannel;
  private onMessageCallback?: (payload: AuthSyncPayload) => void;

  constructor(channelName: string = "opencode-auth-sync") {
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(channelName);
      this.channel.onmessage = (event) => {
        const payload = event.data as AuthSyncPayload;
        if (payload && this.onMessageCallback) {
          this.onMessageCallback(payload);
        }
      };
    }
  }

  public registerCallback(callback: (payload: AuthSyncPayload) => void): void {
    this.onMessageCallback = callback;
  }

  public broadcastAuthChange(action: AuthSyncPayload["action"], token?: string): void {
    if (this.channel) {
      this.channel.postMessage({
        action,
        token,
        timestamp: Date.now(),
      } satisfies AuthSyncPayload);
    }
  }

  public destroy(): void {
    if (this.channel) {
      this.channel.close();
    }
  }
}
