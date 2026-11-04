// Tiny Markdown -> safe HTML renderer (headings, bold/italic, code, links, lists, paragraphs, tables).
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function inline(s: string) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(#topic:([\w-]+)\)/g, '<a href="#" data-topic="$2">$1</a>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
}
export function renderMarkdown(md: string): string {
  const lines = (md ?? '').replace(/\r/g, '').split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (l.startsWith('```')) { const buf: string[] = []; i++; while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]); i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue }
    const h = l.match(/^(#{1,6})\s+(.*)/); if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue }
    if (/^\s*[-*]\s+/.test(l)) { const items: string[] = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*[-*]\s+/, ''))}</li>`); out.push(`<ul>${items.join('')}</ul>`); continue }
    if (/^\d+\.\s+/.test(l)) {
      const items: string[] = []
      while (i < lines.length && (/^\d+\.\s+/.test(lines[i]) || /^\s+[-*]\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (/^\d+\.\s+/.test(lines[i])) { items.push(inline(lines[i++].replace(/^\d+\.\s+/, ''))); continue }
        const sub: string[] = []
        while (i < lines.length && /^\s+[-*]\s+/.test(lines[i])) sub.push(`<li>${inline(lines[i++].replace(/^\s+[-*]\s+/, ''))}</li>`)
        if (sub.length) items[items.length - 1] += `<ul>${sub.join('')}</ul>`
        else items[items.length - 1] += ' ' + inline(lines[i++].trim())
      }
      out.push(`<ol>${items.map((x) => `<li>${x}</li>`).join('')}</ol>`)
      continue
    }
    if (/^\|.*\|\s*$/.test(l) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) { const head = l.split('|').slice(1, -1).map((c) => `<th>${inline(c.trim())}</th>`).join(''); i += 2; const rows: string[] = []; while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(`<tr>${lines[i++].split('|').slice(1, -1).map((c) => `<td>${inline(c.trim())}</td>`).join('')}</tr>`); out.push(`<table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`); continue }
    if (/^>\s?/.test(l)) { out.push(`<blockquote>${inline(l.replace(/^>\s?/, ''))}</blockquote>`); i++; continue }
    if (!l.trim()) { i++; continue }
    const buf: string[] = [lines[i++]]
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*[-*]\s|\d+\.\s|\||>)/.test(lines[i])) buf.push(lines[i++])
    out.push(`<p>${inline(buf.join(' '))}</p>`)
  }
  return out.join('\n')
}
