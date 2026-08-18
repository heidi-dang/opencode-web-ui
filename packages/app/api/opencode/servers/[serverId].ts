import type { NextApiRequest, NextApiResponse } from "next"
import { deleteBackend, getBackend, probeBackend, updateBackend } from "@/server/services/backend-service"

async function requestBody(req: NextApiRequest) {
  if (typeof req.body === "object" && req.body) return req.body
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = String(req.query.serverId)
  try {
    if (req.method === "GET") { const backend = await getBackend(id); return res.status(backend ? 200 : 404).json(backend ? { server: backend.descriptor } : { error: "SERVER_NOT_FOUND" }) }
    if (req.method === "PATCH") {
      const input = await requestBody(req)
      const updated = await updateBackend(id, {
        name: typeof input.name === "string" ? input.name : undefined,
        baseUrl: typeof input.baseUrl === "string" ? input.baseUrl : undefined,
        username: typeof input.username === "string" ? input.username : undefined,
        password: typeof input.password === "string" ? input.password : undefined,
        enabled: typeof input.enabled === "boolean" ? input.enabled : undefined,
      })
      return res.status(updated ? 200 : 404).json(updated ? { server: "descriptor" in updated ? updated.descriptor : updated } : { error: "SERVER_NOT_FOUND" })
    }
    if (req.method === "DELETE") return res.status((await deleteBackend(id)) ? 204 : 404).end()
    if (req.method === "POST" && req.url?.includes("/health")) {
      const result = await probeBackend(id, true)
      return res.status(result.health.healthy ? 200 : 502).json({ server: result.server, ...result.health })
    }
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" })
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "SERVER_OPERATION_FAILED" })
  }
}
