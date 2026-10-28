import { exec } from "node:child_process"

const target = process.argv.slice(2).join(" ")

const cmd = `node_modules\\.bin\\vitest.cmd run ${target} --coverage --coverage.reporter=json-summary --coverage.reporter=text-summary`

exec(cmd, { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 64, encoding: "utf8", timeout: 900000 }, (_err, stdout, stderr) => {
  const plain = (stdout + "\n" + stderr).replace(/\u001b\[[0-9;]*m/g, "")
  const lines = plain.split(/\r?\n/)
  const summary = lines.filter(line => /Tests\s|Test Files\s|Statements|Branches|Functions|Lines/.test(line))
  console.log(summary.join("\n"))
})
