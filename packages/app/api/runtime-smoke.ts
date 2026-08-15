import type { ServerResponse } from "node:http"

export default function handler(_req: unknown, res: ServerResponse) {
  res.statusCode = 200
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.end(JSON.stringify({
    ok: true,
    version: process.version,
    platform: process.platform,
    arch: process.arch,
  }))
}
