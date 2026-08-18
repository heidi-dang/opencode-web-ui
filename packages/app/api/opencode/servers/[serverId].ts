import type { NextApiRequest, NextApiResponse } from "next"
import { deleteServer, getServer, probeRegisteredServer, publicServer, updateServer, updateServerHealth } from "@/server/server-registry"

async function requestBody(req: NextApiRequest) {
  if (typeof req.body === "object" && req.body) return req.body
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
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
    if (req.method === "POST" && req.url?.includes("/health")) {
      const probe = await probeRegisteredServer(id)
      const updated = await updateServerHealth(id, { state: probe.state, protocol: probe.protocol, reachable: probe.reachable, authenticated: probe.authenticated, healthy: probe.healthy, latencyMs: probe.latencyMs, error: probe.error })
      return res.status(200).json({ server: publicServer(updated || server), ...probe })
    }
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" })
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "SERVER_OPERATION_FAILED" })
  }
}
