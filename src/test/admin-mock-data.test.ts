import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { exportToCsv, FORBIDDEN_WORDS_DEFAULT } from '@/lib/admin-mock-data'

const created: Blob[] = []
const revoked: string[] = []
const clicked: HTMLAnchorElement[] = []

function readBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

async function readCsv(blob: Blob): Promise<string> {
  return new TextDecoder('utf-8').decode(await readBytes(blob))
}

describe('exportToCsv', () => {
  beforeEach(() => {
    created.length = 0
    revoked.length = 0
    clicked.length = 0
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        created.push(blob)
        return 'blob:swiftmatch-test'
      },
      revokeObjectURL: (url: string) => {
        revoked.push(url)
      },
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this)
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('пустой список строк не создаёт ни файла, ни ссылки', () => {
    exportToCsv('empty.csv', [])
    expect(created).toHaveLength(0)
    expect(clicked).toHaveLength(0)
    expect(revoked).toHaveLength(0)
  })

  it('пишет заголовки, значения в кавычках и BOM, скачивает под переданным именем', async () => {
    exportToCsv('users.csv', [
      { id: 1, name: 'Анна' },
      { id: 2, name: 'Иван' },
    ])
    expect(created).toHaveLength(1)
    expect(created[0].type).toBe('text/csv;charset=utf-8;')
    const bytes = await readBytes(created[0])
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
    expect(await readCsv(created[0])).toBe('id,name\n"1","Анна"\n"2","Иван"')
    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe('users.csv')
    expect(clicked[0].href).toBe('blob:swiftmatch-test')
  })

  it('кавычки внутри значения удваиваются, а null и undefined превращаются в пустую строку', async () => {
    exportToCsv('quotes.csv', [{ note: 'он сказал "да"', empty: null, missing: undefined }])
    expect(await readCsv(created[0])).toBe('note,empty,missing\n"он сказал ""да""","",""')
  })

  it('числа и булевы значения приводятся к строке', async () => {
    exportToCsv('types.csv', [{ a: 0, b: false, c: true }])
    expect(await readCsv(created[0])).toBe('a,b,c\n"0","false","true"')
  })

  it('освобождает объектный URL ровно один раз и после клика', () => {
    const order: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      order.push('click')
      clicked.push(this)
    })
    exportToCsv('order.csv', [{ a: 1 }])
    order.push('done')
    expect(revoked).toEqual(['blob:swiftmatch-test'])
    expect(order).toEqual(['click', 'done'])
  })
})

describe('FORBIDDEN_WORDS_DEFAULT', () => {
  it('непустой список, все слова в нижнем регистре и без пробелов по краям', () => {
    expect(FORBIDDEN_WORDS_DEFAULT.length).toBeGreaterThan(0)
    for (const word of FORBIDDEN_WORDS_DEFAULT) {
      expect(word).toBe(word.toLowerCase().trim())
      expect(word.length).toBeGreaterThan(0)
    }
  })

  it('без дублей: фильтр не должен содержать одно слово дважды', () => {
    expect(new Set(FORBIDDEN_WORDS_DEFAULT).size).toBe(FORBIDDEN_WORDS_DEFAULT.length)
  })
})
