import { describe, it, expect } from "vitest"
import fs from "fs"
import path from "path"
import { translations } from "@/context/language-context"

type Dict = Record<string, string>

const RU = translations.RU as unknown as Dict
const EN = translations.EN as unknown as Dict

const SRC_DIR = path.resolve(__dirname, "..")
const SCAN_EXT = new Set([".ts", ".tsx"])
const SKIP_DIRS = new Set(["node_modules", "dist", "test", "__tests__", ".git"])

const CYRILLIC = /[Ѐ-ӿ]/

const LATIN_ONLY_OK = [
  "admin.users.email",
  "ads.swiftmatch_title",
  "app.lang.en",
  "auth.email",
  "cookie.title",
  "landing.stats.matches.num",
  "landing.stats.users.num",
  "nav.faq",
  "partner.category.spa",
  "partner.register_email",
  "partner.tier_basic",
  "partner.tier_pro",
  "partner.type_api",
  "partner.type_deeplink",
  "partner.type_saas",
  "polls.marvel_dc.0",
  "polls.marvel_dc.1",
  "profile.pro",
  "safety.contact_email",
  "settings.security.status",
  "verification.photo_placeholder",
]

const ENDONYMS_OK = ["app.lang.en", "app.lang.ru"]

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, acc)
    else if (SCAN_EXT.has(path.extname(entry.name))) acc.push(full)
  }
  return acc
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
}

const ruKeys = Object.keys(RU)
const enKeys = Object.keys(EN)
const sourceFiles = walk(SRC_DIR)

describe("i18n parity: RU vs EN", () => {
  it("одинаковый набор ключей в RU и EN", () => {
    const onlyRu = ruKeys.filter((k) => !(k in EN)).sort()
    const onlyEn = enKeys.filter((k) => !(k in RU)).sort()
    expect({ onlyRu, onlyEn }).toEqual({ onlyRu: [], onlyEn: [] })
  })

  it("в RU нет пустых значений", () => {
    expect(ruKeys.filter((k) => typeof RU[k] !== "string" || RU[k].trim() === "")).toEqual([])
  })

  it("в EN нет пустых значений", () => {
    expect(enKeys.filter((k) => typeof EN[k] !== "string" || EN[k].trim() === "")).toEqual([])
  })

  it("в EN нет кириллицы (кроме эндонимов языков в переключателе)", () => {
    const cyrillicInEn = enKeys.filter((k) => CYRILLIC.test(EN[k])).sort()
    const unexpected = cyrillicInEn.filter((k) => !ENDONYMS_OK.includes(k))
    expect(unexpected).toEqual([])
  })

  it("в RU латиница только у согласованного списка ключей", () => {
    const latinOnly = ruKeys
      .filter((k) => !CYRILLIC.test(RU[k]) && /[A-Za-z]/.test(RU[k]))
      .sort()
    expect(latinOnly).toEqual([...LATIN_ONLY_OK].sort())
  })

  it("плейсхолдеры совпадают в RU и EN для каждого ключа", () => {
    const mismatch = ruKeys
      .filter((k) => k in EN)
      .filter((k) => placeholders(RU[k]).join(",") !== placeholders(EN[k]).join(","))
      .map((k) => ({ key: k, ru: placeholders(RU[k]), en: placeholders(EN[k]) }))
    expect(mismatch).toEqual([])
  })

  it("каждый плейсхолдер встречается в значении ровно один раз", () => {
    const dupes: Array<{ key: string; placeholder: string }> = []
    for (const k of [...ruKeys, ...enKeys]) {
      const counts = new Map<string, number>()
      for (const m of RU[k].matchAll(/\{(\w+)\}/g)) {
        counts.set(m[1], (counts.get(m[1]) ?? 0) + 1)
      }
      for (const [name, count] of counts) {
        if (count > 1) dupes.push({ key: k, placeholder: name })
      }
    }
    expect(dupes).toEqual([])
  })
})

describe("i18n: ни один t('...') в коде не остаётся сырым ключом", () => {
  const known = new Set([...ruKeys, ...enKeys])
  const tCall = /(?<![A-Za-z0-9_])t\(\s*["'`]([a-z0-9_]+(?:\.[a-z0-9_]+)+)["'`]/g
  const missing: Array<{ file: string; key: string }> = []

  for (const file of sourceFiles) {
    const src = fs.readFileSync(file, "utf8")
    for (const match of src.matchAll(tCall)) {
      if (!known.has(match[1])) {
        missing.push({ file: path.relative(SRC_DIR, file), key: match[1] })
      }
    }
  }

  it(`скан прошёл (${sourceFiles.length} файлов)`, () => {
    expect(sourceFiles.length).toBeGreaterThan(50)
  })

  it("нет t() с несуществующим ключом", () => {
    const unique = [...new Map(missing.map((m) => [`${m.file}:${m.key}`, m])).values()]
    expect(unique).toEqual([])
  })

  it("нет анти-паттерна t('key') || 'текст' — fallback мёртвый, т.к. t() возвращает сам ключ", () => {
    const offenders: Array<{ file: string; line: number }> = []
    const pattern = /(?<![A-Za-z0-9_])t\(\s*["'`][^"'`]+["'`]\s*\)\s*\|\|/
    for (const file of sourceFiles) {
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/)
      lines.forEach((line, idx) => {
        if (pattern.test(line)) offenders.push({ file: path.relative(SRC_DIR, file), line: idx + 1 })
      })
    }
    expect(offenders).toEqual([])
  })
})

describe("i18n: locales/*.json не является источником правды", () => {
  it("json-файлы не импортируются нигде в src (иначе две правды)", () => {
    const offenders: string[] = []
    for (const file of sourceFiles) {
      const src = fs.readFileSync(file, "utf8")
      if (/from\s+["'`][^"'`]*locales\//.test(src)) offenders.push(path.relative(SRC_DIR, file))
    }
    expect(offenders).toEqual([])
  })
})
