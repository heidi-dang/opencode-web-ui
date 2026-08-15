import type { IncomingMessage, ServerResponse } from "node:http"
import { handleOpenCodeProxy } from "../src/server/proxy"

type VercelRequest = IncomingMessage & {
  method?: string
  url?: string
  query?: Record<string, string | string[]>
}

type VercelResponse = ServerResponse

export const config = {
  api: { bodyParser: false },
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const original = new URL(req.url || "/", "http://localhost")
  const path = original.searchParams.get("path") || "/"
  original.searchParams.delete("path")
  req.url = `/api/opencode${path}${original.search ? original.search : ""}`
  await handleOpenCodeProxy(req, res)
}
