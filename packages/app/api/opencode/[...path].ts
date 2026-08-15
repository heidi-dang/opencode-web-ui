import type { IncomingMessage, ServerResponse } from "node:http"
import { handleOpenCodeProxy } from "../../src/server/proxy"

type VercelRequest = IncomingMessage & { method?: string; url?: string }

type VercelResponse = ServerResponse

export const config = {
  api: {
    bodyParser: false,
  },
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await handleOpenCodeProxy(req, res)
}
