/**
 * Тесты гейта `scripts/mysql-race-gate.mjs`.
 *
 * Дыра этапа 36 (N1): джоба `test-server` в `ci.yml` не объявляла сервис БД, а
 * единственный тест репозитория на живом MySQL был написан как
 * `describe.skipIf(!admin)`. Вместе это давало зелёную джобу при полном пропуске
 * теста — год CI «проверки гонок на настоящем движке» не выполнялся.
 *
 * Тесты ниже фиксируют обе границы гейта: структура джобы обязана быть такой,
 * чтобы пропуск был невозможен (настоящий `ci.yml` — контрольный зелёный), а
 * каждая лазейка, которая снова делает джобу зелёной без БД (сервис без
 * health-check, флаг в комментарии, `continue-on-error`, `|| true`, тест без
 * падающей проверки), обязана давать находку.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { audit, auditRaceTestSource, auditTestServerJob } from "./mysql-race-gate.mjs";

/** Минимальная джоба `test-server` требуемого вида — все куски опциональны. */
function jobYaml(parts = {}) {
  const {
    services = true,
    image = "mysql:8.0",
    health = true,
    requireMysql = "'1'",
    dbKeys = ["DB_HOST", "DB_USER", "DB_PASSWORD"],
    run = "npm test",
    extra = "",
    commentOut = false,
  } = parts;

  const lines = ["  test-server:", "    runs-on: ubuntu-latest"];
  if (services) {
    lines.push("    services:", "      mysql:");
    if (image) lines.push(`        image: ${image}`);
    if (health) {
      lines.push("        options: >-", '          --health-cmd="mysqladmin ping --silent"');
    }
  }
  lines.push("    env:");
  for (const key of dbKeys) lines.push(`      ${key}: swiftmatch_test`);
  if (requireMysql) lines.push(`      REQUIRE_MYSQL: ${requireMysql}`);
  lines.push("    steps:", "      - uses: actions/checkout@v4");
  if (run) lines.push(`      - run: ${run}`);
  if (extra) lines.push(extra);
  if (commentOut) {
    lines.push("      # services:", "      #   mysql:", "      #     image: mysql:8.0", "      # REQUIRE_MYSQL: '1'");
  }
  return `${lines.join("\n")}\n`;
}

/** Тест-файл требуемого вида. */
function raceSource(parts = {}) {
  const {
    flag = "const requireMysql = process.env.REQUIRE_MYSQL === '1'",
    skipIf = "describe.skipIf(!admin && !requireMysql)",
    assertAdmin = "expect(admin).not.toBeNull()",
    comment = "",
  } = parts;
  return [
    comment,
    "const admin = await probe()",
    flag,
    `${skipIf}('гонки', () => {`,
    "  it('БД доступна', () => {",
    `    ${assertAdmin}`,
    "  })",
    "})",
  ]
    .filter(Boolean)
    .join("\n");
}

describe("mysql-race-gate: настоящий репозиторий", () => {
  it("рабочий ci.yml и рабочий тест-файл дают ноль находок (контрольный зелёный)", () => {
    const result = audit(process.cwd());
    expect(result.facts.jobFound).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it("тот же вывод, если читать файлы по отдельности", () => {
    const ci = fs.readFileSync(path.join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
    const test = fs.readFileSync(
      path.join(process.cwd(), "server/src/__tests__/race.mysql.test.js"),
      "utf8",
    );
    expect(auditTestServerJob(ci.slice(ci.indexOf("  test-server:")))).toEqual([]);
    expect(auditRaceTestSource(test)).toEqual([]);
  });
});

describe("mysql-race-gate: джоба до этапа 36 (сервиса БД нет)", () => {
  it("джоба без блока services — самая исходная дыра N1", () => {
    const problems = auditTestServerJob(jobYaml({ services: false }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("нет сервиса mysql");
  });

  it("перечисление сервисов в комментарии не считается сервисом", () => {
    const problems = auditTestServerJob(jobYaml({ services: false, commentOut: true }));
    expect(problems.some((p) => p.includes("нет сервиса mysql"))).toBe(true);
  });

  it("сервис без образа и без health-check — две находки", () => {
    const problems = auditTestServerJob(jobYaml({ image: null, health: false }));
    expect(problems.some((p) => p.includes("без образа"))).toBe(true);
    expect(problems.some((p) => p.includes("health-check"))).toBe(true);
  });

  it("образ чужой базы не проходит: под ним нечем проверять гонки MySQL", () => {
    const problems = auditTestServerJob(jobYaml({ image: "postgres:16" }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("без образа");
  });

  it("REQUIRE_MYSQL отсутствует — пропуск останется пропуском", () => {
    const problems = auditTestServerJob(jobYaml({ requireMysql: null }));
    expect(problems.some((p) => p.includes("REQUIRE_MYSQL"))).toBe(true);
  });

  it.each([["'0'"], ["true"], ["'true'"], ["0"], [""]])(
    "REQUIRE_MYSQL: %s — не единица, код читает только === '1'",
    (value) => {
      const problems = auditTestServerJob(jobYaml({ requireMysql: value === "" ? "''" : value }));
      expect(problems.some((p) => p.includes("REQUIRE_MYSQL"))).toBe(true);
    },
  );

  it.each([["DB_HOST"], ["DB_USER"], ["DB_PASSWORD"]])("без %s тест пойдёт не туда", (key) => {
    const problems = auditTestServerJob(
      jobYaml({ dbKeys: ["DB_HOST", "DB_USER", "DB_PASSWORD"].filter((k) => k !== key) }),
    );
    expect(problems.some((p) => p.includes(key))).toBe(true);
  });

  it.each([
    ["continue-on-error", "    continue-on-error: true"],
    ["|| true", "      - run: npm test || true"],
  ])("джоба не должна зеленеть при провале: %s", (_label, extra) => {
    const problems = auditTestServerJob(jobYaml({ extra }));
    expect(problems.some((p) => p.includes("зеленеет"))).toBe(true);
  });

  it("без шага npm test живой тест объявлять некому", () => {
    const problems = auditTestServerJob(jobYaml({ run: null }));
    expect(problems.some((p) => p.includes("npm test"))).toBe(true);
  });

  it("рабочая джоба даёт ноль находок (фикстура не weaker реальной)", () => {
    expect(auditTestServerJob(jobYaml())).toEqual([]);
  });
});

describe("mysql-race-gate: тест-файл до этапа 36", () => {
  it("прежний вариант без REQUIRE_MYSQL: четыре находки", () => {
    const source = raceSource({
      flag: "const requireMysql = false",
      skipIf: "describe.skipIf(!admin)",
      assertAdmin: "void admin",
    });
    const problems = auditRaceTestSource(source);
    expect(problems).toHaveLength(4);
    expect(problems.join(" ")).toContain("REQUIRE_MYSQL не читается строго");
    expect(problems.join(" ")).toContain("не учитывает REQUIRE_MYSQL");
    expect(problems.join(" ")).toContain("остался безусловный skipIf");
    expect(problems.join(" ")).toContain("admin === null");
  });

  it("флаг есть, но условие пропуска его не учитывает — флаг декоративный", () => {
    const problems = auditRaceTestSource(raceSource({ skipIf: "describe.skipIf(!admin)" }));
    expect(problems.some((p) => p.includes("не учитывает REQUIRE_MYSQL"))).toBe(true);
    expect(problems.some((p) => p.includes("безусловный skipIf"))).toBe(true);
  });

  it("нет падающей проверки admin — падение будет невнятным, а не «MySQL обязателен»", () => {
    const problems = auditRaceTestSource(raceSource({ assertAdmin: "void admin" }));
    expect(problems).toEqual([
      expect.stringContaining("admin === null"),
    ]);
  });

  it("flag читается не строго: process.env.REQUIRE_MYSQL без сравнения", () => {
    const problems = auditRaceTestSource(raceSource({ flag: "const requireMysql = process.env.REQUIRE_MYSQL" }));
    expect(problems.some((p) => p.includes("строго как '1'"))).toBe(true);
  });

  it("упоминание skipIf(!admin) в //-комментарии не считается конструкцией", () => {
    const problems = auditRaceTestSource(raceSource({ comment: "// прежний код: describe.skipIf(!admin)" }));
    expect(problems).toEqual([]);
  });

  it("рабочий тест-файл даёт ноль находок", () => {
    expect(auditRaceTestSource(raceSource())).toEqual([]);
  });
});

describe("mysql-race-gate: audit() на фикстуре", () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mysql-race-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function putFixture(ci, test) {
    fs.mkdirSync(path.join(root, ".github/workflows"), { recursive: true });
    fs.mkdirSync(path.join(root, "server/src/__tests__"), { recursive: true });
    fs.writeFileSync(path.join(root, ".github/workflows/ci.yml"), ci);
    fs.writeFileSync(path.join(root, "server/src/__tests__/race.mysql.test.js"), test);
  }

  it("нет джобы test-server — находка, а не молчание", () => {
    putFixture("name: ci\non: push\n  other:\n    runs-on: ubuntu-latest\n", raceSource());
    const result = audit(root);
    expect(result.facts.jobFound).toBe(false);
    expect(result.problems).toEqual([expect.stringContaining("джобы нет")]);
  });

  it("собирает находки обеих групп: дыра в джобе плюс дыра в тесте", () => {
    putFixture(jobYaml({ services: false }), raceSource({ assertAdmin: "void admin" }));
    const result = audit(root);
    expect(result.facts.jobFound).toBe(true);
    expect(result.problems.some((p) => p.includes("нет сервиса mysql"))).toBe(true);
    expect(result.problems.some((p) => p.includes("admin === null"))).toBe(true);
  });

  it("полностью чистая фикстура — ноль находок", () => {
    putFixture(jobYaml(), raceSource());
    expect(audit(root).problems).toEqual([]);
  });
});