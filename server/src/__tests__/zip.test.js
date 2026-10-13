import { describe, it, expect } from 'vitest'
import { crc32, buildZip } from '../zip.js'

// Минимальный разбор store-ZIP: EOCD -> центральный каталог -> локальные записи.
// Нужен, чтобы проверить архив независимо от того, кто его писал.
function readEntries(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  expect(eocd).toBeGreaterThanOrEqual(0)
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const entries = []
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(off)).toBe(0x02014b50)
    const crc = buf.readUInt32LE(off + 16)
    const size = buf.readUInt32LE(off + 24)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    expect(buf.readUInt32LE(localOff)).toBe(0x04034b50)
    const localNameLen = buf.readUInt16LE(localOff + 26)
    const localExtraLen = buf.readUInt16LE(localOff + 28)
    const dataStart = localOff + 30 + localNameLen + localExtraLen
    const data = buf.subarray(dataStart, dataStart + size)
    entries.push({ name: buf.subarray(off + 46, off + 46 + nameLen).toString('utf8'), crc, data })
    off += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

describe('zip writer', () => {
  it('crc32 matches the known vector for "123456789"', () => {
    expect(crc32(Buffer.from('123456789', 'utf8'))).toBe(0xcbf43926)
  })

  it('builds an empty archive with a valid EOCD', () => {
    const zip = buildZip([])
    expect(zip.length).toBe(22)
    expect(zip.readUInt32LE(0)).toBe(0x06054b50)
    expect(zip.readUInt16LE(10)).toBe(0)
  })

  it('round-trips text and binary entries with matching CRC', () => {
    const text = Buffer.from('привет, мир', 'utf8')
    const binary = Buffer.from([0, 1, 2, 250, 255, 128])
    const zip = buildZip([
      { path: 'data.json', data: text },
      { path: 'photos/1_a.bin', data: binary },
    ])

    const entries = readEntries(zip)
    expect(entries.map(e => e.name)).toEqual(['data.json', 'photos/1_a.bin'])
    expect(entries[0].data.equals(text)).toBe(true)
    expect(entries[0].crc).toBe(crc32(text))
    expect(entries[1].data.equals(binary)).toBe(true)
    expect(entries[1].crc).toBe(crc32(binary))
  })

  it('starts with the local file header signature', () => {
    const zip = buildZip([{ path: 'a.txt', data: Buffer.from('a') }])
    expect(zip.readUInt32LE(0)).toBe(0x04034b50)
  })
})
