import type { IncomingMessage, ServerResponse } from "node:http"
import { diagnostic } from "./_lib/minimal"

export default function handler(_req: IncomingMessage, res: ServerResponse) {
  res.statusCode = 200
  res.setHeader("content-type", "application/json")
  res.end(JSON.stringify(diagnostic))
}
