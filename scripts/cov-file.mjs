import fs from "fs"
import path from "path"

const file = path.resolve("node_modules/.cache/coverage/coverage-summary.json")
if (!fs.existsSync(file)) {
  console.log("MISS")
  process.exit(1)
}
const j = JSON.parse(fs.readFileSync(file, "utf8"))
const needle = (process.argv[2] ?? "src/pages/chats.tsx").replace(/\\/g, "/")
const keys = Object.keys(j)
const k = keys.find(x => {
  const n = x.replace(/\\/g, "/")
  return n.endsWith(needle) || n.includes(needle)
})
if (!k) {
  console.log("NOTFOUND")
  process.exit(0)
}
const c = j[k]
console.log(
  JSON.stringify({
    file: k.replace(/\\/g, "/"),
    statements: `${c.statements.covered}/${c.statements.total} ${c.statements.pct}%`,
    branches: `${c.branches.covered}/${c.branches.total} ${c.branches.pct}%`,
    functions: `${c.functions.covered}/${c.functions.total} ${c.functions.pct}%`,
    lines: `${c.lines.covered}/${c.lines.total} ${c.lines.pct}%`,
  }),
)
