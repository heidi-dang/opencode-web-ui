import type { IncomingMessage, ServerResponse } from "node:http"
import { proxyOpenCodeRequest } from "@/server/opencode-proxy"

export const config = { api: { bodyParser: false } }

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return proxyOpenCodeRequest(req, res)
}
