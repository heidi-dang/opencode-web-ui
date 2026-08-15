import type { IncomingMessage, ServerResponse } from "node:http"
import { proxyOpenCodeRequest } from "./_lib/opencode-proxy"

type RequestWithUrl = IncomingMessage & { method?: string; url?: string }

export const config = { api: { bodyParser: false } }

export default function handler(req: RequestWithUrl, res: ServerResponse) {
  return proxyOpenCodeRequest(req, res)
}
