import type { ServerResponse } from "node:http"

export default async function handler(_req: unknown, res: ServerResponse) {
  try {
    const module = await import("../src/server/opencode-proxy")
    res.statusCode = 200
    res.setHeader("content-type", "application/json; charset=utf-8")
    res.end(JSON.stringify({ phase: "import", success: true, exports: Object.keys(module) }))
  } catch (error) {
    const value = error instanceof Error ? error : new Error(String(error))
    res.statusCode = 200
    res.setHeader("content-type", "application/json; charset=utf-8")
    res.end(JSON.stringify({
      phase: "import",
      success: false,
      error: { name: value.name, message: value.message, stack: value.stack },
    }))
  }
}
