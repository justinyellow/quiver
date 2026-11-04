// Minimal ZIP writer (store method, no compression) for exporting plain-text collections.
function crc32(buf: Uint8Array) {
  let c, crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) { c = (crc ^ buf[i]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c }
  return (crc ^ 0xffffffff) >>> 0
}
export function makeZip(files: { path: string; content: string }[]): Blob {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff]
  const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]
  for (const f of files) {
    const name = enc.encode(f.path), data = enc.encode(f.content), crc = crc32(data)
    const local = new Uint8Array([...le32(0x04034b50), ...le16(20), ...le16(0x800), ...le16(0), ...le16(0), ...le16(0), ...le32(crc), ...le32(data.length), ...le32(data.length), ...le16(name.length), ...le16(0), ...name])
    parts.push(local, data)
    central.push(new Uint8Array([...le32(0x02014b50), ...le16(20), ...le16(20), ...le16(0x800), ...le16(0), ...le16(0), ...le16(0), ...le32(crc), ...le32(data.length), ...le32(data.length), ...le16(name.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(offset), ...name]))
    offset += local.length + data.length
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0)
  const end = new Uint8Array([...le32(0x06054b50), ...le16(0), ...le16(0), ...le16(files.length), ...le16(files.length), ...le32(cdSize), ...le32(offset), ...le16(0)])
  return new Blob([...parts, ...central, end] as BlobPart[], { type: 'application/zip' })
}
export function downloadZip(name: string, files: { path: string; content: string }[]) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(makeZip(files)); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
