import dns from 'node:dns/promises'
import net from 'node:net'
import { config } from '../config.js'

export class BlockedTargetError extends Error {}

function ipv4ToInt(ip: string) {
  return ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0
}
function inCidr4(ip: string, cidr: string) {
  const [base, bits] = cidr.split('/')
  const mask = bits === '0' ? 0 : (~0 << (32 - Number(bits))) >>> 0
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask)
}

const LOOPBACK4 = ['127.0.0.0/8']
const PRIVATE4 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10']
const LINKLOCAL4 = ['169.254.0.0/16']
const OTHER_BAD4 = ['0.0.0.0/8', '224.0.0.0/4', '240.0.0.0/4']

export function classifyIp(ip: string): 'loopback' | 'private' | 'linklocal' | 'bad' | 'public' {
  if (net.isIPv4(ip)) {
    if (LOOPBACK4.some((c) => inCidr4(ip, c))) return 'loopback'
    if (LINKLOCAL4.some((c) => inCidr4(ip, c))) return 'linklocal'
    if (PRIVATE4.some((c) => inCidr4(ip, c))) return 'private'
    if (OTHER_BAD4.some((c) => inCidr4(ip, c))) return 'bad'
    return 'public'
  }
  const v6 = ip.toLowerCase()
  if (v6 === '::1') return 'loopback'
  if (v6 === '::') return 'bad'
  if (v6.startsWith('fe80:')) return 'linklocal'
  if (v6.startsWith('fc') || v6.startsWith('fd')) return 'private'
  if (v6.startsWith('::ffff:')) return classifyIp(v6.slice(7))
  if (v6.startsWith('ff')) return 'bad'
  return 'public'
}

export interface GuardOptions {
  allowPrivate?: boolean
  allowLoopback?: boolean
  blockedHosts?: string[]
}

export function assertIpAllowed(ip: string, host: string, opts: GuardOptions = {}) {
  const allowPrivate = opts.allowPrivate ?? config.allowPrivateTargets
  const allowLoopback = opts.allowLoopback ?? (config.allowLoopbackTargets || !config.isProd)
  const cls = classifyIp(ip)
  if (cls === 'linklocal' || cls === 'bad') throw new BlockedTargetError(`Target ${host} resolves to blocked address ${ip}`)
  if (cls === 'loopback' && !allowLoopback) throw new BlockedTargetError(`Target ${host} resolves to loopback address ${ip} (set ALLOW_LOOPBACK_TARGETS=true to allow)`)
  if (cls === 'private' && !allowPrivate) throw new BlockedTargetError(`Target ${host} resolves to private address ${ip} (set ALLOW_PRIVATE_TARGETS=true to allow)`)
}

export function assertHostAllowed(host: string, opts: GuardOptions = {}) {
  const blocked = [...(opts.blockedHosts ?? []), ...config.blockedHosts]
  const h = host.toLowerCase()
  for (const b of blocked) {
    const pat = b.toLowerCase()
    if (pat.startsWith('*.') ? h.endsWith(pat.slice(1)) || h === pat.slice(2) : h === pat) throw new BlockedTargetError(`Target host ${host} is blocked by policy`)
  }
  if (h === 'metadata.google.internal' || h.endsWith('.internal') && h.includes('metadata')) throw new BlockedTargetError('Cloud metadata endpoints are blocked')
}

/** Resolve a hostname, verify every address, and return addresses to pin the connection to. */
export async function resolveAndCheck(host: string, opts: GuardOptions = {}): Promise<{ address: string; family: 4 | 6 }[]> {
  assertHostAllowed(host, opts)
  if (net.isIP(host)) {
    assertIpAllowed(host, host, opts)
    return [{ address: host, family: net.isIPv4(host) ? 4 : 6 }]
  }
  let addrs: { address: string; family: number }[]
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true })
  } catch (e: any) {
    throw new Error(`DNS lookup failed for ${host}: ${e.code || e.message}`)
  }
  if (!addrs.length) throw new Error(`DNS lookup returned no addresses for ${host}`)
  for (const a of addrs) assertIpAllowed(a.address, host, opts)
  return addrs.map((a) => ({ address: a.address, family: a.family as 4 | 6 }))
}
