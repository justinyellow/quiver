import type { Cookie } from './types.js'

export function parseSetCookie(header: string, requestUrl: URL): Cookie | null {
  const parts = header.split(';').map((s) => s.trim())
  const [nameValue, ...attrs] = parts
  const eq = nameValue.indexOf('=')
  if (eq < 0) return null
  const c: Cookie = {
    name: nameValue.slice(0, eq).trim(),
    value: nameValue.slice(eq + 1).trim(),
    domain: requestUrl.hostname,
    path: '/',
    expires: null,
  }
  for (const a of attrs) {
    const [k, ...rest] = a.split('=')
    const v = rest.join('=')
    switch (k.toLowerCase()) {
      case 'domain': c.domain = v.replace(/^\./, '').toLowerCase(); break
      case 'path': c.path = v || '/'; break
      case 'expires': { const t = Date.parse(v); if (!isNaN(t)) c.expires = t; break }
      case 'max-age': { const n = Number(v); if (!isNaN(n)) c.expires = Date.now() + n * 1000; break }
      case 'secure': c.secure = true; break
      case 'httponly': c.httpOnly = true; break
      case 'samesite': c.sameSite = v; break
    }
  }
  return c
}

export function cookieMatches(c: Cookie, url: URL): boolean {
  if (c.expires && c.expires < Date.now()) return false
  const host = url.hostname.toLowerCase()
  const dom = c.domain.toLowerCase()
  if (!(host === dom || host.endsWith('.' + dom))) return false
  if (!url.pathname.startsWith(c.path)) return false
  if (c.secure && url.protocol !== 'https:') return false
  return true
}

export function mergeCookies(jar: Cookie[], incoming: Cookie[]): Cookie[] {
  const out = jar.filter((c) => !(c.expires && c.expires < Date.now()))
  for (const c of incoming) {
    const i = out.findIndex((x) => x.name === c.name && x.domain === c.domain && x.path === c.path)
    if (i >= 0) out[i] = c
    else out.push(c)
  }
  return out
}

export function cookieHeader(jar: Cookie[], url: URL): string {
  return jar.filter((c) => cookieMatches(c, url)).map((c) => `${c.name}=${c.value}`).join('; ')
}
