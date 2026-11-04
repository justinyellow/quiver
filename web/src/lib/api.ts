export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: any) { super(message) }
}

async function call<T = any>(method: string, url: string, body?: any, opts: { raw?: boolean } = {}): Promise<T> {
  const res = await fetch('/api' + url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  if (opts.raw) return res as any
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || res.statusText || 'Request failed', data?.details)
  return data
}

export const api = {
  get: <T = any>(url: string) => call<T>('GET', url),
  post: <T = any>(url: string, body?: any) => call<T>('POST', url, body ?? {}),
  put: <T = any>(url: string, body?: any) => call<T>('PUT', url, body ?? {}),
  patch: <T = any>(url: string, body?: any) => call<T>('PATCH', url, body ?? {}),
  del: <T = any>(url: string) => call<T>('DELETE', url),
  /** POST and read a text/event-stream response, invoking onEvent for each event. */
  async sse(url: string, body: any, onEvent: (event: string, data: any) => void, signal?: AbortSignal) {
    const res = await fetch('/api' + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
    if (!res.ok || !res.body) { const t = await res.text(); let d: any; try { d = JSON.parse(t) } catch { d = { error: t } } throw new ApiError(res.status, d.error || 'Request failed', d.details) }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2)
        let ev = 'message', data = ''
        for (const line of chunk.split('\n')) { if (line.startsWith('event: ')) ev = line.slice(7); else if (line.startsWith('data: ')) data += line.slice(6) }
        try { onEvent(ev, JSON.parse(data)) } catch { onEvent(ev, data) }
      }
    }
  },
}
