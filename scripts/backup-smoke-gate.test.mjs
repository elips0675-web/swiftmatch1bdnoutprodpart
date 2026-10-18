/**
 * Тесты гейта `scripts/backup-smoke-gate.mjs`.
 *
 * Дыра TEST-02: шаг `Backup restore smoke test` в джобе `server-test` был
 * заведён, но снимал дамп с `--no-data` и восстанавливал пустую схему. Смоук
 * был зелёным ровно тогда, когда не проверял ничего: ни одна строка не
 * сверялась, «таблица существует» верно и для свежесозданной базы, а ошибки
 * восстановления гасились самодельным разбором дампа и `catch {}`.
 *
 * Тесты фиксируют обе границы: реальный репозиторий — контрольный зелёный, а
 * каждая лазейка, которая снова делает прогон зелёным без восстановления данных
 * (шаг без DB_NAME, джоба без схемы, `continue-on-error`, дамп без данных,
 * разбор по `;\n`, пустой `catch`, отсутствие гейта в CI), — даёт находку.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getJobSection } from "./e2e-gate-audit.mjs";
import {
  audit,
  auditRunJob,
  auditSmokeSource,
  auditWiring,
  findSilentCatches,
  stripJsComments,
} from "./backup-smoke-gate.mjs";

/** Минимальная джоба `server-test` требуемого вида — все куски опциональны. */
function deployYaml(parts = {}) {
  const {
    smokeStep = true,
    dbKeys = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"],
    schema = true,
    extra = "",
    commentOut = false,
  } = parts;

  const lines = ["  server-test:", "    runs-on: ubuntu-latest", "    steps:", "      - uses: actions/checkout@v4"];
  if (schema) {
    lines.push(
      "      - name: Init test DB schema",
      "        run: mysql -h127.0.0.1 -uroot -pswiftmatch_test swiftmatch_test < database/mysql_schema.sql",
    );
  }
  if (smokeStep) {
    lines.push("      - name: Backup restore smoke test", "        run: node scripts/verify-backup.mjs", "        env:");
    for (const key of dbKeys) lines.push(`          ${key}: swiftmatch_test`);
  }
  if (extra) lines.push(extra);
  if (commentOut) {
    lines.push("      # - name: Backup restore smoke test", "      #   run: node scripts/verify-backup.mjs");
  }
  lines.push(
    "  lint-and-typecheck:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - run: npm run check:backup-smoke",
  );
  return `${lines.join("\n")}\n`;
}

/** Минимальный смоук требуемого вида — каждый обязательный кусок отключаем. */
function smokeSource(parts = {}) {
  const {
    noData = false,
    mysqldump = true,
    canary = true,
    rowCounts = true,
    splitter = false,
    exitOne = true,
    catchBody = "fail(err.message)",
    cleanup = true,
  } = parts;
  return [
    "import { spawnSync } from 'child_process'",
    `const args = ['--single-transaction'${noData ? ", '--no-data'" : ""}, DB_NAME]`,
    mysqldump ? "const dump = spawnSync(mysqldumpBin, args)" : "const dump = buildSqlByHand()",
    canary ? "await conn.query('CREATE TABLE _backup_smoke_canary (id INT)')" : "",
    rowCounts ? "const [[src]] = await conn.query('SELECT COUNT(*) AS cnt FROM t')" : "",
    splitter
      ? "const statements = dumpText.split(/;\\s*\\n/)"
      : "const restore = spawnSync(mysqlBin, [VERIFY_DB], { input: dump })",
    "try {",
    "  run()",
    "} catch (err) {",
    `  ${catchBody}`,
    "}",
    cleanup ? "await conn.query('DROP DATABASE IF EXISTS `verify`')" : "",
    "if (problems.length) {",
    exitOne ? "  process.exit(1)" : "  console.log('нашли, но зелёные')",
    "}",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Смоук до TEST-02: схема без данных, самодельный разбор дампа, проглоченная ошибка. */
function legacySmokeSource() {
  return [
    "import fs from 'fs'",
    "const dump = execSync(`${mysqldump} --no-data --routines --triggers ${DB_NAME}`)",
    "for (const statement of dump.split(/;\\s*\\n/)) {",
    "  if (!statement.trim()) continue",
    "  try {",
    "    await conn.query(statement)",
    "  } catch {",
    "  }",
    "}",
    "if (missing.length) {",
    "  console.log('таблиц нет:', missing)",
    "}",
  ].join("\n");
}

describe("backup-smoke-gate: настоящий репозиторий", () => {
  it("рабочие workflow и смоук дают ноль находок (контрольный зелёный)", () => {
    const result = audit(process.cwd());
    expect(result.facts.jobFound).toBe(true);
    expect(result.facts.smokeStepFound).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it("тот же вывод по частям: джоба, смоук и запуск гейта по отдельности", () => {
    const deploy = fs.readFileSync(path.join(process.cwd(), ".github/workflows/deploy.yml"), "utf8");
    const smoke = fs.readFileSync(path.join(process.cwd(), "scripts/verify-backup.mjs"), "utf8");
    expect(auditRunJob(getJobSection(deploy, "server-test"))).toEqual([]);
    expect(auditSmokeSource(smoke)).toEqual([]);
    expect(auditWiring(process.cwd())).toEqual([]);
  });
});

describe("backup-smoke-gate: джоба server-test", () => {
  it("джоба без шага смоука — самая исходная дыра TEST-02", () => {
    const problems = auditRunJob(deployYaml({ smokeStep: false }));
    expect(problems).toEqual([expect.stringContaining("прогон «restore → smoke» не заведён")]);
  });

  it("шаг в комментарии не считается шагом", () => {
    const problems = auditRunJob(deployYaml({ smokeStep: false, commentOut: true }));
    expect(problems.some((p) => p.includes("не заведён"))).toBe(true);
  });

  it.each([["DB_HOST"], ["DB_USER"], ["DB_PASSWORD"], ["DB_NAME"]])(
    "шаг смоука без %s — «зелёный» будет не про собранную БД",
    (key) => {
      const problems = auditRunJob(
        deployYaml({ dbKeys: ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"].filter((k) => k !== key) }),
      );
      expect(problems.some((p) => p.includes(key))).toBe(true);
    },
  );

  it("джоба без шага, создающего схему, — восстанавливать нечего", () => {
    const problems = auditRunJob(deployYaml({ schema: false }));
    expect(problems).toEqual([expect.stringContaining("database/mysql_schema.sql")]);
  });

  it.each([
    ["continue-on-error", "    continue-on-error: true"],
    ["|| true", "      - run: node scripts/verify-backup.mjs || true"],
  ])("джоба не должна зеленеть при провале: %s", (_label, extra) => {
    const problems = auditRunJob(deployYaml({ extra }));
    expect(problems.some((p) => p.includes("зеленеет"))).toBe(true);
  });

  it("рабочая джоба даёт ноль находок (фикстура не слабее реальной)", () => {
    expect(auditRunJob(deployYaml())).toEqual([]);
  });
});

describe("backup-smoke-gate: сам смоук", () => {
  it("дамп с --no-data — восстанавливается пустая схема, ровно дыра TEST-02", () => {
    const problems = auditSmokeSource(smokeSource({ noData: true }));
    expect(problems).toEqual([expect.stringContaining("--no-data")]);
  });

  it("легаси-вариант смоука (схема без данных) даёт не меньше четырёх находок", () => {
    const problems = auditSmokeSource(legacySmokeSource());
    expect(problems.length).toBeGreaterThanOrEqual(4);
    const joined = problems.join(" ");
    expect(joined).toContain("--no-data");
    expect(joined).toContain("канарейки");
    expect(joined).toContain("числа строк");
    expect(joined).toContain("разбирается по");
    expect(joined).toContain("пустые catch");
  });

  it("дамп собирается вручную — восстановление не тем путём, каким восстанавливают бэкап", () => {
    const problems = auditSmokeSource(smokeSource({ mysqldump: false }));
    expect(problems.some((p) => p.includes("mysqldump"))).toBe(true);
  });

  it("без канарейки восстановленные данные ни с чем не сверяются", () => {
    const problems = auditSmokeSource(smokeSource({ canary: false }));
    expect(problems).toEqual([expect.stringContaining("канарейки")]);
  });

  it("без сверки числа строк потеря части данных невидима", () => {
    const problems = auditSmokeSource(smokeSource({ rowCounts: false }));
    expect(problems).toEqual([expect.stringContaining("числа строк")]);
  });

  it("разбор дампа по ';\\n' — класс дефекта до TEST-02", () => {
    const problems = auditSmokeSource(smokeSource({ splitter: true }));
    expect(problems).toEqual([expect.stringContaining("разбирается по")]);
  });

  it("без process.exit(1) находка не делает прогон красным", () => {
    const problems = auditSmokeSource(smokeSource({ exitOne: false }));
    expect(problems).toEqual([expect.stringContaining("process.exit(1)")]);
  });

  it("без удаления scratch-БД следующий прогон проверяет её остатки", () => {
    const problems = auditSmokeSource(smokeSource({ cleanup: false }));
    expect(problems).toEqual([expect.stringContaining("scratch-БД")]);
  });

  it("пустой catch с комментарием внутри — тот же проглоченный провал восстановления", () => {
    const source = smokeSource({ catchBody: "// skip warnings" });
    const problems = auditSmokeSource(source);
    expect(problems).toEqual([expect.stringContaining("пустые catch")]);
    const line = source.split("\n").findIndex((l) => l.includes("catch")) + 1;
    expect(problems[0]).toContain(`в строках ${line}`);
  });

  it("catch с настоящим телом ошибку не гасит", () => {
    expect(auditSmokeSource(smokeSource({ catchBody: "fail(err.message)" }))).toEqual([]);
  });

  it("упоминание --no-data в блочном комментарии не считается дампом без данных", () => {
    const source = `/**\n * Прежний вариант снимал дамп с --no-data.\n */\n${smokeSource()}`;
    expect(auditSmokeSource(source)).toEqual([]);
  });

  it("рабочий смоук даёт ноль находок", () => {
    expect(auditSmokeSource(smokeSource())).toEqual([]);
  });
});

describe("backup-smoke-gate: вспомогательные разборы", () => {
  it("номера строк сохраняются после вырезания комментариев", () => {
    const source = ["/* a", "b */", "const x = 1", "", "catch {", "}", ""].join("\n");
    expect(stripJsComments(source).split("\n")).toHaveLength(source.split("\n").length);
    expect(findSilentCatches(source)).toEqual([5]);
  });

  it("catch с телом не считается пустым", () => {
    expect(findSilentCatches("try {\n  run()\n} catch (err) {\n  fail(err)\n}")).toEqual([]);
  });

  it("catch с inline-комментарием внутри считается пустым", () => {
    expect(findSilentCatches("catch {\n  // ничего\n}")).toEqual([1]);
  });
});

describe("backup-smoke-gate: запуск самого гейта", () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "backup-smoke-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function putFixture(parts = {}) {
    const {
      ci = "name: CI\non: push\n  backup-smoke:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node scripts/backup-smoke-gate.mjs\n",
      deploy = deployYaml(),
      smoke = smokeSource(),
      npmScript = "node scripts/backup-smoke-gate.mjs",
    } = parts;
    fs.mkdirSync(path.join(root, ".github/workflows"), { recursive: true });
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, ".github/workflows/ci.yml"), ci);
    fs.writeFileSync(path.join(root, ".github/workflows/deploy.yml"), deploy);
    fs.writeFileSync(path.join(root, "scripts/verify-backup.mjs"), smoke);
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: npmScript ? { "check:backup-smoke": npmScript } : {} }, null, 2),
    );
  }

  it("рабочая фикстура даёт ноль находок", () => {
    putFixture();
    expect(audit(root).problems).toEqual([]);
  });

  it("нет npm-скрипта — гейт нечем запустить", () => {
    putFixture({ npmScript: null });
    expect(auditWiring(root)).toEqual([expect.stringContaining("нет скрипта check:backup-smoke")]);
  });

  it("npm-скрипт запускает чужой файл — проверка ничего не значит", () => {
    putFixture({ npmScript: "node scripts/other-gate.mjs" });
    expect(auditWiring(root)).toEqual([expect.stringContaining("а не scripts/backup-smoke-gate.mjs")]);
  });

  it("в ci.yml нет джобы с гейтом — гейт живёт только локально", () => {
    putFixture({ ci: "name: CI\non: push\n" });
    expect(auditWiring(root)).toEqual([expect.stringContaining("гейт живёт только локально")]);
  });

  it("в lint-and-typecheck нет шага гейта — деплой его не блокирует", () => {
    putFixture({
      deploy: deployYaml().replace("      - run: npm run check:backup-smoke\n", ""),
    });
    expect(auditWiring(root)).toEqual([expect.stringContaining("не блокирует деплой")]);
  });

  it("нет джобы server-test — находка, а не молчание", () => {
    putFixture({
      deploy:
        "name: CI\non: push\n  other:\n    runs-on: ubuntu-latest\n  lint-and-typecheck:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run check:backup-smoke\n",
    });
    const result = audit(root);
    expect(result.facts.jobFound).toBe(false);
    expect(result.problems).toEqual([expect.stringContaining("джобы нет")]);
  });

  it("собирает находки обеих групп: дыра в джобе плюс дыра в смоуке", () => {
    putFixture({ deploy: deployYaml({ smokeStep: false }), smoke: smokeSource({ noData: true }) });
    const problems = audit(root).problems;
    expect(problems.some((p) => p.includes("не заведён"))).toBe(true);
    expect(problems.some((p) => p.includes("--no-data"))).toBe(true);
  });
});
