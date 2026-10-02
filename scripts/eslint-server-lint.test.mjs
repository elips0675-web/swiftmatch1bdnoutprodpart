/**
 * Тесты гейта линтинга бэкенда (`npm run lint:server` → `eslint server/src`).
 *
 * До этапа 29 конфиг ESLint покрывал только ts/tsx-файлы: 131 файл
 * server/src (22 762 строки) не проверялся линтером вообще — при том что
 * 782 серверных теста были зелёные. Первая же сборка нашла 69 нарушений, и
 * два из них оказались не мусором, а молчащими багами:
 *   • `admin/users.tsx:78` шлёт `premium` в списке юзеров, а бэкенд
 *     разбирал этот параметр и не применял — фильтр «План» не делал ничего;
 *   • `push.js` импортировал `sendFcmToUser`, но не вызывал его ни разу.
 *
 * Тесты ниже фиксируют границу гейта в обе стороны: он обязан ловить
 * неиспользуемый импорт/переменную/параметр, прощать сознательные
 * конструкции (`catch {}`, префикс `_`, отбрасывание rest-элемента) и быть
 * зелёным на текущем коде. Отдельно проверяется, что гейт не отвалили от
 * CI молча: конфиг без блока для server/src даёт «0 ошибок» честно
 * и тихо — ровно то состояние, в котором бэкенд снова остался без линтинга.
 *
 * Файлы обходятся вручную и линтуются через `lintText`, а не `lintFiles`:
 * корневой vitest работает в jsdom, где у `AbortSignal` нет
 * `throwIfAborted`, а `lintFiles` на нём падает. Свой обход заодно даёт
 * проверку, что дерево не пустое (иначе «0 ошибок» — это vacuous pass).
 */

import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = path.join(ROOT, "eslint.config.js");
const FIXTURE = path.join(ROOT, "server/src/__fixture__.js");
const FIXTURE_TEST = path.join(ROOT, "server/src/__tests__/__fixture__.test.js");

const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: CONFIG });

async function messagesFor(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((m) => m.ruleId);
}

function jsFilesIn(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) jsFilesIn(target, acc);
    else if (entry.name.endsWith(".js")) acc.push(target);
  }
  return acc;
}

describe("Гейт линтинга бэкенда: eslint server/src", () => {
  it("ловит неиспользуемый импорт в файле server/src", async () => {
    const rules = await messagesFor("import path from 'path'\nexport const a = 1\n", FIXTURE);
    expect(rules).toContain("no-unused-vars");
  });

  it("ловит неиспользуемую локальную переменную", async () => {
    const rules = await messagesFor("const t = new Date()\nexport const a = 1\n", FIXTURE);
    expect(rules).toContain("no-unused-vars");
  });

  it("ловит неиспользуемый параметр без префикса _", async () => {
    const rules = await messagesFor("export function f(a, b) {\n  return a\n}\n", FIXTURE);
    expect(rules).toContain("no-unused-vars");
  });

  it("прощает сознательные конструкции: префикс _, отбрасывание rest, catch {}", async () => {
    const code = [
      "export function sanitize(rows, _cache) {",
      "  const { location, ...rest } = rows[0]",
      "  try { JSON.parse(rest.bio) } catch {}",
      "  return { location, rest }",
      "}",
    ].join("\n");
    expect(await messagesFor(code, FIXTURE)).toEqual([]);
  });

  it("по-прежнему ловит бессмысленный try/catch с перебросом того же исключения", async () => {
    const code = [
      "export async function q(fn) {",
      "  try {",
      "    return await fn()",
      "  } catch (err) {",
      "    throw err",
      "  }",
      "}",
    ].join("\n");
    expect(await messagesFor(code, FIXTURE)).toContain("no-useless-catch");
  });

  it("в тестах vitest требует явный импорт глобалов (vi не объявлен)", async () => {
    const rules = await messagesFor("vi.clearAllMocks()\nexport const x = 1\n", FIXTURE_TEST);
    expect(rules).toContain("no-undef");
  });

  it("текущий код server/src чист: 0 ошибок", async () => {
    const files = jsFilesIn(path.join(ROOT, "server/src"));
    expect(files.length).toBeGreaterThan(100);
    const errors = [];
    for (const file of files) {
      const [result] = await eslint.lintText(fs.readFileSync(file, "utf8"), { filePath: file });
      for (const m of result.messages) {
        if (m.severity !== 2) continue;
        errors.push(`${path.relative(ROOT, file).split(path.sep).join("/")}:${m.line}:${m.column} ${m.ruleId} ${m.message}`);
      }
    }
    expect(errors).toEqual([]);
  }, 60_000);

  it("гейт объявлен скриптом и вызывается в CI и в деплое", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts["lint:server"]).toBe("eslint server/src");
    const ci = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toContain("npm run lint:server");
    const deploy = fs.readFileSync(path.join(ROOT, ".github/workflows/deploy.yml"), "utf8");
    expect(deploy).toContain("npm run lint:server");
  });
});
