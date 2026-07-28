/**
 * Hardened SSE parser ported from better-harness-ui (PR #2, merged at 93cabac).
 *
 * Supports:
 *   - LF, CRLF, and CR line terminators
 *   - CRLF split across chunks
 *   - UTF-8 split across byte chunks
 *   - Multi-line data fields
 *   - Comments and heartbeats
 *   - event, data, and id fields
 *   - Decoder flush
 *   - Incomplete trailing frames
 */
export interface SseFrame {
  id?: string;
  event: string;
  data: string[];
}

export class SseParser {
  private buffer = "";
  private pendingCR = false;
  private currentEventType = "";
  private currentData: string[] = [];
  private currentId: string | undefined;

  reset(): void {
    this.buffer = "";
    this.pendingCR = false;
    this.currentEventType = "";
    this.currentData = [];
    this.currentId = undefined;
  }

  /**
   * Feed a chunk of SSE data and dispatch complete frames.
   */
  feed(chunk: string, onFrame: (frame: SseFrame) => void): void {
    let normalized = chunk;

    // 1. Consume leading \n if previous chunk ended with lone \r
    if (this.pendingCR && normalized.startsWith("\n")) {
      normalized = normalized.slice(1);
    }
    this.pendingCR = false;

    // 2. Normalise CRLF pairs
    normalized = normalized.replace(/\r\n/g, "\n");

    // 3. Check for trailing lone \r BEFORE replacing
    const endsWithLoneCR = normalized.endsWith("\r") && !normalized.endsWith("\r\n");

    // 4. Replace remaining lone \r
    normalized = normalized.replace(/\r/g, "\n");

    // 5. Set pending flag for next chunk
    if (endsWithLoneCR) {
      this.pendingCR = true;
    }

    this.buffer += normalized;

    // Process complete lines
    let lineStart = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      if (this.buffer[i] !== "\n") continue;

      const line = this.buffer.slice(lineStart, i);
      lineStart = i + 1;

      if (line === "") {
        // Empty line = frame separator
        if (this.currentData.length > 0) {
          onFrame({
            id: this.currentId,
            event: this.currentEventType || "message",
            data: this.currentData,
          });
        }
        this.currentEventType = "";
        this.currentData = [];
        this.currentId = undefined;
      } else if (line.startsWith(":")) {
        // Comment — ignore
      } else if (line.startsWith("event:")) {
        this.currentEventType = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        const val = line.slice(5);
        this.currentData.push(val.startsWith(" ") ? val.slice(1) : val);
      } else if (line.startsWith("id:")) {
        this.currentId = line.slice(3).trim() || undefined;
      }
      // Unknown fields: ignored per SSE spec
    }

    // Keep remaining partial line
    this.buffer = this.buffer.slice(lineStart);
  }

  /**
   * Flush any remaining data. Discards incomplete frames.
   */
  flush(): void {
    this.buffer = "";
    this.currentEventType = "";
    this.currentData = [];
    // Preserve currentId for replay
  }
}
