// Минимальный ZIP-писатель (метод store, без сжатия) — без внешних зависимостей.
// Извлечён из server/src/backup.js (админ-бэкап файлов), чтобы переиспользовать
// в GDPR-экспорте (P3 #29).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function writeU16(buf, offset, value) {
  buf[offset] = value & 0xff
  buf[offset + 1] = (value >>> 8) & 0xff
}

function writeU32(buf, offset, value) {
  buf[offset] = value & 0xff
  buf[offset + 1] = (value >>> 8) & 0xff
  buf[offset + 2] = (value >>> 16) & 0xff
  buf[offset + 3] = (value >>> 24) & 0xff
}

export function buildZip(files) {
  const encoder = new TextEncoder()
  const chunks = []
  const central = []
  let offset = 0

  for (const { path, data } of files) {
    const name = encoder.encode(path)
    const crc = crc32(data)

    const local = Buffer.alloc(30 + name.length + data.length)
    writeU32(local, 0, 0x04034b50)
    writeU16(local, 4, 20)
    writeU16(local, 6, 0)
    writeU16(local, 8, 0)
    writeU32(local, 14, crc)
    writeU32(local, 18, data.length)
    writeU32(local, 22, data.length)
    writeU16(local, 26, name.length)
    writeU16(local, 28, 0)
    Buffer.from(name).copy(local, 30)
    data.copy(local, 30 + name.length)
    chunks.push(local)
    central.push({ name, crc, size: data.length, offset })
    offset += local.length
  }

  const centralStart = offset
  for (const c of central) {
    const entry = Buffer.alloc(46 + c.name.length)
    writeU32(entry, 0, 0x02014b50)
    writeU16(entry, 4, 20)
    writeU16(entry, 6, 20)
    writeU16(entry, 8, 0)
    writeU16(entry, 10, 0)
    writeU16(entry, 16, c.crc & 0xffff)
    writeU16(entry, 18, (c.crc >>> 16) & 0xffff)
    writeU32(entry, 20, c.size)
    writeU32(entry, 24, c.size)
    writeU16(entry, 28, c.name.length)
    writeU16(entry, 30, 0)
    writeU16(entry, 32, 0)
    writeU16(entry, 34, 0)
    writeU16(entry, 36, 0)
    writeU32(entry, 38, 0)
    writeU32(entry, 42, c.offset)
    Buffer.from(c.name).copy(entry, 46)
    chunks.push(entry)
  }

  const centralSize = offset - centralStart
  const eocd = Buffer.alloc(22)
  writeU32(eocd, 0, 0x06054b50)
  writeU16(eocd, 4, 0)
  writeU16(eocd, 6, 0)
  writeU16(eocd, 8, central.length)
  writeU16(eocd, 10, central.length)
  writeU32(eocd, 12, centralSize)
  writeU32(eocd, 16, centralStart)
  writeU16(eocd, 20, 0)
  chunks.push(eocd)

  return Buffer.concat(chunks)
}
