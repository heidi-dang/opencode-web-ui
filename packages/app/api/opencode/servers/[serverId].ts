import type { NextApiRequest, NextApiResponse } from "next"
import { deleteServer, getServer, publicServer, updateServer } from "@/server/server-registry"

async function requestBody(req: NextApiRequest) {
  if (typeof req.body === "object" && req.body) return req.body
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
}

async function health(server: Awaited<ReturnType<typeof getServer>>) {
  if (!server) return { state: "UNHEALTHY", error: "SERVER_NOT_FOUND" }
  const base = new URL(server.baseUrl)
  const started = Date.now()
  try {
    const response = await fetch(new URL(`${base.pathname.replace(/\/$/, "")}/global/health`, base.origin), {
      headers: server.password ? { Authorization: `Basic ${Buffer.from(`${server.username || "opencode"}:${server.password}`).toString("base64")}` } : undefined,
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return { state: "UNHEALTHY", error: "OPENCODE_HEALTH_FAILED", status: response.status, latencyMs: Date.now() - started }
    const protocol = response.headers.get("x-opencode-version") ? "v2" : "v1"
    return { state: "READY", protocol, latencyMs: Date.now() - started }
  } catch (error) {
    const code = error instanceof Error && error.name === "TimeoutError" ? "CONNECT_TIMEOUT" : "GATEWAY_CANNOT_REACH_SERVER"
    return { state: "UNHEALTHY", error: code, latencyMs: Date.now() - started }
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = String(req.query.serverId)
  try {
    const server = await getServer(id)
    if (req.method === "GET") return res.status(server ? 200 : 404).json(server ? { server: publicServer(server) } : { error: "SERVER_NOT_FOUND" })
    if (req.method === "PATCH") {
      const input = await requestBody(req)
      const updated = await updateServer(id, {
        name: typeof input.name === "string" ? input.name : undefined,
        baseUrl: typeof input.baseUrl === "string" ? input.baseUrl : undefined,
        username: typeof input.username === "string" ? input.username : undefined,
        password: typeof input.password === "string" ? input.password : undefined,
        enabled: typeof input.enabled === "boolean" ? input.enabled : undefined,
      })
      return res.status(updated ? 200 : 404).json(updated ? { server: publicServer(updated) } : { error: "SERVER_NOT_FOUND" })
    }
    if (req.method === "DELETE") return res.status((await deleteServer(id)) ? 204 : 404).end()
    if (req.method === "POST" && req.url?.includes("/health")) return res.status(200).json(await health(server))
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" })
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "SERVER_OPERATION_FAILED" })
  }
}
