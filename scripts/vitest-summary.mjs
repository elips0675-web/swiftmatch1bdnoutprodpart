import { exec } from "node:child_process"

const args = process.argv.slice(2)
const target = args.length > 0 ? args.join(" ") : ""

const cmd = `node_modules\\.bin\\vitest.cmd run ${target}`

exec(cmd, { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 64, encoding: "utf8" }, (_err, stdout, stderr) => {
  const plain = (stdout + "\n" + stderr).replace(/\u001b\[[0-9;]*m/g, "")
  const lines = plain.split(/\r?\n/)

  const failures = []
  let capture = false
  for (const line of lines) {
    if (/Failed Tests|FAIL /.test(line)) capture = true
    if (capture) failures.push(line)
    if (failures.length > 200) break
  }

  if (failures.length > 0) {
    console.log("=== FAILURES ===")
    console.log(failures.join("\n"))
  }

  const summary = lines.filter(line => /Tests\s|Test Files\s/.test(line))
  console.log("=== SUMMARY ===")
  console.log(summary.join("\n"))
})
