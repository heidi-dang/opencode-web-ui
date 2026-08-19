import { MOCK_PROJECT_LIST, MOCK_SESSIONS, MOCK_PROVIDERS } from "./review-fixtures";
import type { ServerEvent } from "@/context/server-sdk";

type MockResponse = {
  status: number;
  ok: boolean;
  headers: Headers;
  json: () => Promise<any>;
  text: () => Promise<string>;
  body?: ReadableStream<Uint8Array>;
};

function createMockResponse(data: any, status = 200): MockResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

function createSseStream(events: any[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for (const event of events) {
        let msg = `id: ${event.id || Date.now()}\nevent: ${event.type}\n`;
        if (event.data) {
          msg += `data: ${JSON.stringify(event.data)}\n`;
        }
        msg += `\n`;
        controller.enqueue(encoder.encode(msg));
        await new Promise(r => setTimeout(r, 50));
      }
      controller.close();
    }
  });
}

export function mockFetchHandler(input: RequestInfo | URL, init?: RequestInit): Promise<Response> | null {
  const url = typeof input === "string" ? new URL(input, window.location.origin) : (input instanceof Request ? new URL(input.url) : input);
  
  // Only mock review://local
  if (url.hostname !== "local" && url.protocol !== "review:") {
    return null; // Let real fetch handle it, or fail
  }

  const path = url.pathname;
  console.log("[Mock Fetch]", init?.method || "GET", path);

  if (path.startsWith("/api/directories")) {
    return Promise.resolve(createMockResponse({ directories: MOCK_PROJECT_LIST }) as any);
  }
  
  if (path.startsWith("/api/sessions")) {
    const match = path.match(/^\/api\/sessions\/([^/]+)$/);
    if (match) {
      const sessionID = match[1];
      const session = MOCK_SESSIONS.find(s => s.id === sessionID) || MOCK_SESSIONS[0];
      return Promise.resolve(createMockResponse({ session }) as any);
    }
    return Promise.resolve(createMockResponse({ sessions: MOCK_SESSIONS, pagination: { total: MOCK_SESSIONS.length, hasMore: false } }) as any);
  }

  if (path.startsWith("/api/models")) {
    return Promise.resolve(createMockResponse({ providers: MOCK_PROVIDERS, models: [] }) as any);
  }

  if (path.startsWith("/api/v2/bootstrap")) {
    return Promise.resolve(createMockResponse({ 
      auth: { mode: "none" },
      environment: { channel: "dev", version: "1.0.0-review" },
      features: {} 
    }) as any);
  }
  
  if (path.startsWith("/api/health")) {
    return Promise.resolve(createMockResponse({ status: "ok" }) as any);
  }
  
  if (path.startsWith("/api/lsp")) {
    return Promise.resolve(createMockResponse({ status: "ok" }) as any);
  }

  // Event stream mock
  if (path.startsWith("/api/events")) {
    const stream = createSseStream([
      { type: "server.connected", data: { status: "ready" } }
    ]);
    return Promise.resolve({
      status: 200,
      ok: true,
      headers: new Headers({ "content-type": "text/event-stream" }),
      body: stream,
      json: async () => { throw new Error("stream"); },
      text: async () => { throw new Error("stream"); }
    } as any);
  }

  return Promise.resolve(createMockResponse({ error: "Not Found" }, 404) as any);
}
