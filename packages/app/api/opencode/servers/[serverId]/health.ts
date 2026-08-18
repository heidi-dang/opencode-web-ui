import type { NextApiRequest, NextApiResponse } from "next"
import { getServer } from "@/server/server-registry"
import { probeBackend } from "@/server/services/backend-service"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const server = await getServer(String(req.query.serverId))
  if (!server) return res.status(404).json({ error: "SERVER_NOT_FOUND" })
  const result = await probeBackend(server.id)
  return res.status(200).json({ server: result.server, ...result.health })
}
