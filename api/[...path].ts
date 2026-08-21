import type { IncomingMessage, ServerResponse } from "node:http"
import { apiResponse } from "../packages/app/src/server/production-server"

export const config = {
  api: { bodyParser: false },
  runtime: "bun1.x",
}

type VercelRequest = IncomingMessage & { method?: string; url?: string }

type VercelResponse = ServerResponse & {
  statusCode: number
  headersSent: boolean
  setHeader(name: string, value: string | number | readonly string[]): VercelResponse
  getHeader(name: string): string | number | string[] | undefined
  write(chunk: Uint8Array | string): boolean
  end(chunk?: Uint8Array | string): VercelResponse
  once(event: string, listener: (...args: any[]) => void): VercelResponse
  removeListener(event: string, listener: (...args: any[]) => void): VercelResponse
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const protocol = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",", 1)[0] || "https"
  const host = req.headers.host || "localhost"
  const request = new Request(`${protocol}://${host}${req.url || "/"}`, {
    method: req.method || "GET",
    headers: Object.entries(req.headers).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, Array.isArray(value) ? value.join(", ") : value]],
    ),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : (req as unknown as BodyInit),
    // @ts-expect-error Node streams are accepted by the Node fetch implementation.
    duplex: "half",
  })
  const response = await apiResponse(request)
  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  const body = new Uint8Array(await response.arrayBuffer())
  res.end(body)
}
