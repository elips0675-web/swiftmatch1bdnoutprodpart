import fs from "fs"
import path from "path"

const file = path.resolve("node_modules/.cache/coverage/coverage-final.json")
if (!fs.existsSync(file)) {
  console.log("MISS")
  process.exit(1)
}
const j = JSON.parse(fs.readFileSync(file, "utf8"))
const needle = (process.argv[2] ?? "src/pages/chats.tsx").replace(/\\/g, "/")
const key = Object.keys(j).find(x => x.replace(/\\/g, "/").endsWith(needle))
if (!key) {
  console.log("NOTFOUND")
  process.exit(0)
}
const c = j[key]
const src = fs.readFileSync(key, "utf8")

const firstNewline = src.indexOf("\n")
const sep = firstNewline > 0 && src[firstNewline - 1] === "\r" ? 2 : 1
const lines = src.split(/\r?\n/)

const offsetOf = (line, column) => {
  let offset = 0
  for (let i = 0; i < line - 1; i += 1) offset += lines[i].length + sep
  return offset + column
}

const uncovered = []
for (const [id, counts] of Object.entries(c.b)) {
  const map = c.branchMap[id]
  counts.forEach((count, idx) => {
    if (count === 0) {
      const loc = map.locations?.[idx] ?? map.loc
      const start = offsetOf(loc.start.line, loc.start.column)
      const end = offsetOf(loc.end.line, loc.end.column)
      uncovered.push({
        line: loc.start.line,
        col: loc.start.column,
        type: map.type,
        branch: Number(id),
        arm: idx,
        text: src.slice(start, end).replace(/\s+/g, " ").slice(0, 160),
      })
    }
  })
}

for (const u of uncovered.sort((a, b) => a.line - b.line || a.col - b.col)) {
  console.log(`L${u.line}:${u.col} [${u.type} b${u.branch} a${u.arm}] <<${u.text}>>`)
}
