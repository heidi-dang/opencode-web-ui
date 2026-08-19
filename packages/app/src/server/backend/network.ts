import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

export type NetworkPolicy = { allowPrivate?: boolean; allowLoopback?: boolean; maxRedirects?: number }
export function normalizeBackendEndpoint(value: string) { const url = new URL(value.trim()); if (!/^https?:$/.test(url.protocol)) throw new Error("UNSUPPORTED_URL_SCHEME"); if (url.username || url.password || url.hash) throw new Error("UNSAFE_SERVER_URL"); url.search = ""; url.pathname = url.pathname.replace(/\/+$/, "") || "/"; return url.toString().replace(/\/$/, "") }
function isExplicitlyAllowedPrivateOrigin(url: URL) {
  return (process.env.OPENCODE_ALLOWED_SERVERS ?? "").split(",").map((value) => value.trim()).filter(Boolean).some((value) => {
    try {
      return new URL(value).origin === url.origin
    } catch {
      return false
    }
  })
}
function ipv4ToBigInt(value: string) {
  const parts = value.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined
  return parts.reduce((result, part) => (result << 8n) | BigInt(part), 0n)
}

function bigintToIpv4(value: bigint) {
  return [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 0xffn)).join(".")
}

function ipv6ToBigInt(value: string) {
  let input = value.toLowerCase()
  if (input.includes(".")) {
    const index = input.lastIndexOf(":")
    const ipv4 = ipv4ToBigInt(input.slice(index + 1))
    if (ipv4 === undefined) return undefined
    input = `${input.slice(0, index)}:${((ipv4 >> 16n) & 0xffffn).toString(16)}:${(ipv4 & 0xffffn).toString(16)}`
  }
  const halves = input.split("::")
  if (halves.length > 2) return undefined
  const left = halves[0] ? halves[0].split(":").filter(Boolean) : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(":").filter(Boolean) : []
  if (left.some((part) => !/^[0-9a-f]{1,4}$/.test(part)) || right.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined
  const groups = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left
  if (groups.length !== 8) return undefined
  return groups.reduce((result, part) => (result << 16n) | BigInt(`0x${part}`), 0n)
}

function inIpv6Range(value: bigint, prefix: bigint, bits: number) {
  return (value >> BigInt(128 - bits)) === (prefix >> BigInt(128 - bits))
}

export function isPrivateAddress(address: string) {
  const normalized = address.replace(/^\[|\]$/g, "").toLowerCase()
  const ipv4 = ipv4ToBigInt(normalized)
  if (ipv4 !== undefined) {
    const first = Number(ipv4 >> 24n)
    const second = Number((ipv4 >> 16n) & 0xffn)
    return first === 0 || first === 10 || first === 127 || (first === 100 && second >= 64 && second <= 127) || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)
  }
  const ipv6 = ipv6ToBigInt(normalized)
  if (ipv6 === undefined) return false
  const mappedPrefix = ipv6 >> 32n
  if (mappedPrefix === 0xffffn) return isPrivateAddress(bigintToIpv4(ipv6 & 0xffffffffn))
  return ipv6 === 0n || ipv6 === 1n || inIpv6Range(ipv6, ipv6ToBigInt("fc00::")!, 7) || inIpv6Range(ipv6, ipv6ToBigInt("fe80::")!, 10)
}

type ResolvedAddress = { address: string; family: number }
type DestinationOptions = NetworkPolicy & { lookup?: (hostname: string) => Promise<ResolvedAddress[]> }

export async function validateBackendDestination(endpoint: string, options: DestinationOptions = {}) {
  const url = new URL(normalizeBackendEndpoint(endpoint))
  const hostname = url.hostname.replace(/^\[|\]$/g, "")
  const explicitlyAllowed = isExplicitlyAllowedPrivateOrigin(url)
  if (options.allowPrivate) return url
  if (explicitlyAllowed) return url
  if (hostname === "localhost" || isPrivateAddress(hostname)) {
    throw new Error("PRIVATE_NETWORK_NOT_ALLOWED")
  }
  if (isIP(hostname)) return url
  const resolve = options.lookup || (async (name: string) => lookup(name, { all: true, verbatim: true }))
  let addresses: ResolvedAddress[]
  try {
    addresses = await resolve(hostname)
  } catch {
    throw new Error("DNS_RESOLUTION_FAILED")
  }
  if (!addresses.length) throw new Error("DNS_RESOLUTION_FAILED")
  if (!explicitlyAllowed && addresses.some((item) => isPrivateAddress(item.address))) throw new Error("PRIVATE_NETWORK_NOT_ALLOWED")
  return url
}

export function assertNetworkPolicy(endpoint: string, policy: NetworkPolicy = {}) { const url = new URL(normalizeBackendEndpoint(endpoint)); if (!policy.allowPrivate && (url.hostname.toLowerCase() === "localhost" || isPrivateAddress(url.hostname)) && !isExplicitlyAllowedPrivateOrigin(url)) throw new Error("PRIVATE_NETWORK_NOT_ALLOWED"); return url }
export function proxyHeaders(input: HeadersInit | undefined, authorization?: string) { const headers = new Headers(input); headers.delete("authorization"); headers.delete("host"); if (authorization) headers.set("authorization", authorization); return headers }
