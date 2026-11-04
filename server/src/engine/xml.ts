// Minimal XML -> JSON (xml2js-like: { root: { child: [ ... ] } }) for script helpers.
export function xmlToJson(xml: string): any {
  const tokens = xml.replace(/<\?xml[^>]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, c) => escape(c))
  const root: any = { $$children: [] }
  const stack: any[] = [root]
  const re = /<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*"[^"]*"|\s+[\w:.-]+\s*=\s*'[^']*')*)\s*(\/?)>|([^<]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tokens))) {
    const top = stack[stack.length - 1]
    if (m[1]) { stack.pop(); continue }
    if (m[2]) {
      const node: any = { $$name: m[2], $$children: [], $: {} }
      for (const a of m[3].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) node.$[a[1]] = unescape(a[2] ?? a[3] ?? '')
      top.$$children.push(node)
      if (!m[4]) stack.push(node)
      continue
    }
    if (m[5] && m[5].trim()) top.$$children.push(unescape(m[5].trim()))
  }
  const build = (node: any): any => {
    const textParts = node.$$children.filter((c: any) => typeof c === 'string')
    const els = node.$$children.filter((c: any) => typeof c !== 'string')
    if (!els.length && !Object.keys(node.$).length) return textParts.join('')
    const o: any = {}
    if (Object.keys(node.$).length) o.$ = node.$
    if (textParts.length) o._ = textParts.join('')
    for (const el of els) (o[el.$$name] = o[el.$$name] || []).push(build(el))
    return o
  }
  const out: any = {}
  for (const el of root.$$children) if (typeof el !== 'string') out[el.$$name] = build(el)
  return out
}
function unescape(s: string) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&') }
function escape(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
