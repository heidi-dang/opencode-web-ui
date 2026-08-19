import type { NextApiRequest, NextApiResponse } from "next"
import { getServer } from "@/server/server-registry"
import { probeBackend } from "@/server/services/backend-service"
import { serializeControlPlaneHealth } from "@/server/control-plane-contract"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" })
  const server = await getServer(String(req.query.serverId))
  if (!server) return res.status(404).json({ error: "SERVER_NOT_FOUND" })
  const result = await probeBackend(server.id, true)
  return res.status(result.health.healthy ? 200 : 502).json(serializeControlPlaneHealth(result.server, result.health))
}
