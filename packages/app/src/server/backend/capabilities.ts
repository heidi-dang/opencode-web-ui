import type { BackendCapabilities } from "./domain"
export function supports(capabilities: BackendCapabilities, capability: keyof BackendCapabilities) { return capabilities[capability] === true }
export function unsupported(capability: keyof BackendCapabilities): never { throw new Error(`CAPABILITY_UNSUPPORTED:${capability}`) }
