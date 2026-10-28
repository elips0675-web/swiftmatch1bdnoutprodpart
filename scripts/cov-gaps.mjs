import fs from "fs"
import path from "path"

const file = path.resolve("node_modules/.cache/coverage/coverage-final.json")
if (!fs.existsSync(file)) {
  console.log("MISS " + file)
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

const uncoveredStatements = []
for (const [id, count] of Object.entries(c.s)) {
  if (count === 0) {
    const loc = c.statementMap[id]
    uncoveredStatements.push(loc.start.line)
  }
}

const uncoveredBranches = []
for (const [id, counts] of Object.entries(c.b)) {
  const map = c.branchMap[id]
  counts.forEach((count, idx) => {
    if (count === 0) {
      const loc = map.locations?.[idx] ?? map.loc
      uncoveredBranches.push({
        line: loc.start.line,
        type: map.type,
        branch: Number(id),
        arm: idx,
      })
    }
  })
}

const uncoveredFunctions = []
for (const [id, count] of Object.entries(c.f)) {
  if (count === 0) {
    const loc = c.fnMap[id]
    uncoveredFunctions.push({ line: loc.decl.start.line, name: loc.name })
  }
}

console.log("STATEMENT LINES:", JSON.stringify([...new Set(uncoveredStatements)].sort((a, b) => a - b)))
console.log("FUNCTIONS:", JSON.stringify(uncoveredFunctions))
console.log("BRANCHES:")
for (const b of uncoveredBranches.sort((x, y) => x.line - y.line)) {
  console.log(`  line ${b.line} type=${b.type} branch=${b.branch} arm=${b.arm}`)
}
