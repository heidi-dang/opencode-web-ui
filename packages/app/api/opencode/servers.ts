import type { NextApiRequest, NextApiResponse } from "next"
import { listBackendDescriptors, probeBackend, registerBackend } from "@/server/services/backend-service"

async function body(req: NextApiRequest) {
  if (typeof req.body === "object" && req.body) return req.body
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === "GET") { const descriptors = await listBackendDescriptors(); return res.status(200).json({ servers: descriptors }) }
    if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" })
    const input = await body(req)
    const server = await registerBackend({
      name: typeof input.name === "string" ? input.name : undefined,
      baseUrl: typeof input.baseUrl === "string" ? input.baseUrl : "",
      username: typeof input.username === "string" ? input.username : undefined,
      password: typeof input.password === "string" ? input.password : undefined,
      enabled: input.enabled !== false,
    })
    const result = await probeBackend(server.id)
    return res.status(201).json({
      server: result.server,
      ready: result.health.healthy,
      reachability: result.health.reachable ? (result.health.healthy ? "SERVER_READY" : "SERVER_HEALTH_FAILED") : "SERVER_REGISTERED_BUT_UNREACHABLE",
      probe: { ...result.health },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "REGISTRATION_FAILED"
    const status = ["UNSUPPORTED_URL_SCHEME", "UNSAFE_SERVER_URL", "INVALID_SERVER_URL", "DUPLICATE_SERVER_URL"].includes(message) ? 400 : 500
    return res.status(status).json({ error: message })
  }
}
