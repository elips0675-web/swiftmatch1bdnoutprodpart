/**
 * Тесты гейта `scripts/test-counter-audit.mjs`.
 *
 * Гейт появился после того, как счётчики тестов разошлись в пяти файлах
 * документации (779 / 807 / 849 при фактических 867). Он же — первое
 * место, где мой код молча портил документацию: `--fix` дописывал новые
 * значения в конец строки («24 файла» → «24 файлафайла24теста152»), потому
 * что `m.indices[g]` — абсолютные смещения во всём тексте, а не смещения
 * внутри совпадения. Тесты ниже фиксируют именно эту границу: любая правка
 * чисел обязана менять **только цифры** и не трогать окружающий текст.
 */

import { describe, expect, it } from "vitest";

import {
  activeClaims,
  checkClaims,
  checkInventoryRows,
  countsFromPlaywrightList,
  countsFromVitestReport,
  fixClaims,
  fixInventoryRows,
  normalizeEol,
  parseInventoryRows,
  plural,
  totalsOf,
} from "./test-counter-audit.mjs";

const COUNTS = {
  frontTests: 152,
  frontFiles: 24,
  serverTests: 715,
  serverFiles: 52,
  e2eTests: 150,
  e2eFiles: 19,
  totalTests: 867,
};

const readmeClaim = (kind, id) => ({
  id,
  suite: "unit",
  re: /^(- \*\*[^*]+\*\* )(\d+)( )([\wа-яё-]+)/m,
  slots: [
    { kind, group: 2, word: false, checked: true },
    { kind, group: 4, word: true, checked: true },
  ],
});

const README_LINE = "- **Сервер (Vitest):** 632 теста, 48 файлов — **0 failures**";
const README_FIXED = "- **Сервер (Vitest):** 715 тестов, 48 файлов — **0 failures**";

const datesClaim = {
  id: "date",
  suite: "all",
  re: /срез на (\d{2}\.\d{2}\.\d{4}):/m,
  slots: [{ kind: "date", group: 1, word: false, checked: false }],
};

describe("plural", () => {
  it("склоняет числа как русские окончания", () => {
    const forms = ["файл", "файла", "файлов"];
    expect(plural(1, forms)).toBe("файл");
    expect(plural(2, forms)).toBe("файла");
    expect(plural(5, forms)).toBe("файлов");
    expect(plural(21, forms)).toBe("файл");
    expect(plural(22, forms)).toBe("файла");
    expect(plural(52, forms)).toBe("файла");
  });

  it("одиннадцать и четырнадцать — только «файлов»", () => {
    const forms = ["файл", "файла", "файлов"];
    expect(plural(11, forms)).toBe("файлов");
    expect(plural(14, forms)).toBe("файлов");
    expect(plural(112, forms)).toBe("файлов");
  });
});

describe("normalizeEol", () => {
  it("возвращает LF-файл без изменений", () => {
    expect(normalizeEol("a\nb\n")).toEqual({ eol: "\n", text: "a\nb\n" });
  });

  it("нормализует CRLF и запоминает стиль для обратной записи", () => {
    expect(normalizeEol("a\r\nb\r\n")).toEqual({ eol: "\r\n", text: "a\nb\n" });
  });
});

describe("countsFromVitestReport", () => {
  it("берёт файлы из testResults, а не из numTotalTestSuites", () => {
    const counts = countsFromVitestReport(
      {
        numTotalTests: 10,
        numPassedTests: 9,
        numFailedTests: 1,
        numTotalTestSuites: 3,
        testResults: [
          { name: "/repo/server/src/__tests__/a.test.js", assertionResults: [1, 2, 3, 4] },
          { name: "/repo/src/b.test.tsx", assertionResults: [1, 2, 3] },
        ],
      },
      "/repo",
    );
    expect(counts.tests).toBe(10);
    expect(counts.files).toBe(2);
    expect(counts.failed).toBe(1);
    expect([...counts.perFile]).toEqual([
      ["server/src/__tests__/a.test.js", 4],
      ["src/b.test.tsx", 3],
    ]);
  });
});

describe("countsFromPlaywrightList", () => {
  const spec = (n) => ({ tests: Array.from({ length: n }, (_, i) => ({ title: `t${i}` })) });

  it("считает тесты в поддереве suite, а не в последнем спеке", () => {
    const { tests, files, perFile } = countsFromPlaywrightList([
      { file: "/repo/e2e/audit-full.spec.ts", specs: [], suites: [{ specs: [spec(2)], suites: [{ specs: [spec(3), spec(4)] }] }] },
    ]);
    expect(tests).toBe(9);
    expect(files).toBe(1);
    expect(perFile.get("e2e/audit-full.spec.ts")).toBe(9);
  });

  it("отказывается сверять спеки с одинаковым именем", () => {
    expect(() =>
      countsFromPlaywrightList([
        { file: "/repo/e2e/a/x.spec.ts", specs: [spec(1)], suites: [] },
        { file: "/repo/e2e/b/x.spec.ts", specs: [spec(1)], suites: [] },
      ]),
    ).toThrow(/одинаковым именем/);
  });
});

describe("totalsOf", () => {
  it("складывает фронт и сервер — E2E в «итого» не входит", () => {
    const totals = totalsOf({
      front: { tests: 173, files: 25, perFile: new Map([["src/a.test.tsx", 152]]) },
      server: { tests: 715, files: 52, perFile: new Map([["server/src/__tests__/a.test.js", 715]]) },
      e2e: { tests: 150, files: 19, perFile: new Map([["e2e/c.spec.ts", 150]]) },
      total: 888,
    });
    expect(totals.totalTests).toBe(888);
    expect(totals.e2eTests).toBe(150);
  });

  it("считает каждую секцию инвентаря по своему префиксу", () => {
    const totals = totalsOf({
      front: {
        tests: 173,
        files: 25,
        perFile: new Map([
          ["src/a.test.tsx", 152],
          ["scripts/gate.test.mjs", 21],
        ]),
      },
      server: { tests: 715, files: 52, perFile: new Map([["server/src/__tests__/a.test.js", 715]]) },
      e2e: { tests: 150, files: 19, perFile: new Map([["e2e/c.spec.ts", 150]]) },
      total: 888,
    });
    expect([totals.frontTableFiles, totals.frontTableTests]).toEqual([1, 152]);
    expect([totals.scriptsTableFiles, totals.scriptsTableTests]).toEqual([1, 21]);
    expect([totals.serverTableFiles, totals.serverTableTests]).toEqual([1, 715]);
    expect([totals.e2eTableFiles, totals.e2eTableTests]).toEqual([1, 150]);
  });
});

describe("checkClaims", () => {
  it("находит расхождение числа и окончания", () => {
    const problems = checkClaims("README.md", README_LINE, [readmeClaim("serverTests", "server")], COUNTS);
    expect(problems).toHaveLength(2);
    expect(problems[0].message).toBe("715 → 632");
    expect(problems[1].message).toBe("«теста» → «тестов» (715)");
  });

  it("молчит, когда цифры совпадают", () => {
    expect(checkClaims("README.md", README_FIXED, [readmeClaim("serverTests", "server")], COUNTS)).toEqual([]);
  });

  it("сообщает о ненайденной строке, а не пропускает её молча", () => {
    const problems = checkClaims("README.md", "ничего похожего", [readmeClaim("serverTests", "server")], COUNTS);
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toMatch(/не найдена/);
  });
});

describe("fixClaims", () => {
  const claims = [readmeClaim("serverTests", "server")];

  it("меняет только число и окончание, остальной текст не трогает", () => {
    expect(fixClaims(README_LINE, claims, COUNTS, "01.01.2030")).toBe(README_FIXED);
  });

  it("регрессия: не дописывает значения в конец строки", () => {
    const fixed = fixClaims(README_LINE, claims, COUNTS, "01.01.2030");
    expect(fixed).not.toMatch(/теста\d|файла\d/);
    expect(fixed.match(/715/g)).toHaveLength(1);
  });

  it("регрессия: совпадение в конце файла не съезжает по индексам", () => {
    const padded = `${"padding\n".repeat(40)}${README_LINE}`;
    expect(fixClaims(padded, claims, COUNTS, "01.01.2030")).toBe(`${"padding\n".repeat(40)}${README_FIXED}`);
  });

  it("правит все вхождения шаблона в файле", () => {
    const fixed = fixClaims(`${README_LINE}\n${README_LINE}`, claims, COUNTS, "01.01.2030");
    expect(fixed.split("\n")).toEqual([README_FIXED, README_FIXED]);
  });

  it("обновляет дату среза", () => {
    const text = "Актуальный срез на 30.09.2026: **779/779** тестов";
    expect(fixClaims(text, [datesClaim], COUNTS, "01.01.2030")).toBe(
      "Актуальный срез на 01.01.2030: **779/779** тестов",
    );
  });

  it("идемпотентен: повторный фикс ничего не меняет", () => {
    const once = fixClaims(README_LINE, claims, COUNTS, "01.01.2030");
    expect(fixClaims(once, claims, COUNTS, "01.01.2030")).toBe(once);
  });
});

describe("activeClaims", () => {
  const slot = (kind, group) => ({ kind, group, word: false, checked: true });
  const allClaim = {
    id: "snapshot-suites",
    suite: "all",
    re: /(\d+) spec/,
    slots: [slot("serverTests", 1), slot("e2eTests", 2), slot("e2eFiles", 3)],
  };
  const e2eClaim = { id: "run-e2e", suite: "e2e", re: /(\d+)/, slots: [slot("e2eTests", 1)] };

  it("без флага отдаёт claim'ы как есть", () => {
    const claims = [allClaim, e2eClaim];
    expect(activeClaims(claims, {})).toBe(claims);
  });

  it("--skip-e2e выбрасывает e2e-claim'ы и их слоты внутри suite:'all'", () => {
    const active = activeClaims([allClaim, e2eClaim], { skipE2E: true });
    expect(active.map((c) => c.id)).toEqual(["snapshot-suites"]);
    expect(active[0].slots.map((s) => s.kind)).toEqual(["serverTests"]);
    expect(allClaim.slots).toHaveLength(3);
  });

  it("--skip-e2e не сверяет выключенный E2E с нулём", () => {
    const text = "сервер 715/715 в 52 файла, E2E 19 спеков / 150 тестов";
    const claim = activeClaims([{ ...allClaim, re: /(\d+)\/(\d+) в|(\d+) спек/ }], { skipE2E: true });
    expect(checkClaims("project-context.md", text, claim, { ...COUNTS, e2eTests: 0, e2eFiles: 0 })).toEqual([]);
  });
});

describe("parseInventoryRows", () => {
  const table = [
    "| Файл | Что покрывает | Тестов |",
    "|---|---|---|",
    "| `server/src/__tests__/a.test.js` | предикат | 4 |",
    "| `src/b.test.tsx` | страница | 2 |",
    "| `e2e/c.spec.ts` | сценарий | 7 |",
    "| `scripts/gate.test.mjs` | гейт | 21 |",
    "| `docs/не-тест.md` | не тест | 99 |",
  ].join("\n");

  it("берёт только строки с путём тест-файла, включая .mjs", () => {
    const rows = parseInventoryRows(table);
    expect([...rows.keys()]).toEqual([
      "server/src/__tests__/a.test.js",
      "src/b.test.tsx",
      "e2e/c.spec.ts",
      "scripts/gate.test.mjs",
    ]);
    expect(rows.get("src/b.test.tsx").claimed).toBe(2);
  });

  it("--skip-e2e не считает строки e2e/ ни лишними, ни отсутствующими", () => {
    const perFile = new Map([
      ["server/src/__tests__/a.test.js", 5],
      ["src/b.test.tsx", 3],
      ["scripts/gate.test.mjs", 21],
    ]);
    const problems = checkInventoryRows("inv.md", table, perFile, { skipE2E: true });
    expect(problems.map((p) => p.message)).toEqual([
      "server/src/__tests__/a.test.js: в прогоне 5, в инвентаре 4",
      "src/b.test.tsx: в прогоне 3, в инвентаре 2",
    ]);
  });

  it("checkInventoryRows ругается и на лишнюю, и на отсутствующую строку", () => {
    const problems = checkInventoryRows("inv.md", table, new Map([
      ["server/src/__tests__/a.test.js", 5],
      ["src/b.test.tsx", 3],
      ["e2e/c.spec.ts", 7],
      ["server/src/__tests__/new.test.js", 16],
    ]));
    expect(problems.map((p) => p.message)).toEqual([
      "server/src/__tests__/a.test.js: в прогоне 5, в инвентаре 4",
      "src/b.test.tsx: в прогоне 3, в инвентаре 2",
      "scripts/gate.test.mjs — в прогоне такого тест-файла нет",
      "server/src/__tests__/new.test.js (16 тестов) — нет строки в инвентаре",
    ]);
  });
});

describe("fixInventoryRows", () => {
  const perFile = new Map([
    ["server/src/__tests__/a.test.js", 16],
    ["server/src/__tests__/b.test.js", 3],
    ["src/ui.test.tsx", 2],
    ["e2e/c.spec.ts", 7],
    ["scripts/gate.test.mjs", 21],
  ]);

  const threeSections = [
    "## Сервер — 1 файл, 4 теста",
    "",
    "| Файл | Что покрывает | Тестов |",
    "|---|---|---|",
    "| `server/src/__tests__/a.test.js` | старое | 4 |",
    "",
    "## Фронт — 1 файл, 2 теста",
    "",
    "| Файл | Что покрывает | Тестов |",
    "|---|---|---|",
    "| `src/ui.test.tsx` | страница | 2 |",
    "",
    "## E2E (Playwright) — 1 спек, 7 `test()`",
    "",
    "| Файл | Что покрывает | Тестов |",
    "|---|---|---|",
    "| `e2e/c.spec.ts` | сценарий | 7 |",
    "",
    "## Скрипты гейтов — 1 файл, 0 тестов",
    "",
    "| Файл | Что покрывает | Тестов |",
    "|---|---|---|",
    "| `scripts/gate.test.mjs` | гейт | 0 |",
  ].join("\n");

  it("регрессия: правка одной строки не портит соседние", () => {
    const fixed = fixInventoryRows(threeSections, perFile);
    const lines = fixed.split("\n");
    expect(lines).toContain("| `server/src/__tests__/a.test.js` | старое | 16 |");
    expect(lines).toContain("| `server/src/__tests__/b.test.js` | ⚠️ требует описания | 3 |");
    expect(lines).toContain("| `src/ui.test.tsx` | страница | 2 |");
    expect(lines).toContain("| `e2e/c.spec.ts` | сценарий | 7 |");
    expect(lines).toContain("| `scripts/gate.test.mjs` | гейт | 21 |");
    expect(fixed).not.toMatch(/16\|\||\|\| `src/);
  });

  it("строка теста гейта правится в своей секции, а не в «Фронт»", () => {
    const lines = fixInventoryRows(threeSections, perFile).split("\n");
    const frontIndex = lines.findIndex((l) => l.startsWith("## Фронт"));
    const scriptsIndex = lines.findIndex((l) => l.startsWith("## Скрипты гейтов"));
    const scriptsRow = lines.findIndex((l) => l.startsWith("| `scripts/gate.test.mjs`"));
    expect(frontIndex).toBeLessThan(scriptsIndex);
    expect(scriptsRow).toBeGreaterThan(scriptsIndex);
  });

  it("после фикса строковая сверка молчит", () => {
    expect(checkInventoryRows("inv.md", fixInventoryRows(threeSections, perFile), perFile)).toEqual([]);
  });
});

describe("дефект парсера инвентаря: экранированная черта и дубли", () => {
  const escapedTable = [
    "| Файл | Что покрывает | Тестов |",
    "|---|---|---|",
    "| `scripts/gate.test.mjs` | команда `npm test \\|\\| true` | 21 |",
  ].join("\n");

  it("парсит строку с `\\|` в описании", () => {
    expect(parseInventoryRows(escapedTable).get("scripts/gate.test.mjs").claimed).toBe(21);
  });

  it("не сообщает «нет строки» про строку с `\\|`", () => {
    const problems = checkInventoryRows("inv.md", escapedTable, new Map([["scripts/gate.test.mjs", 21]]));
    expect(problems).toEqual([]);
  });

  it("видит дубль строки, а не молчит", () => {
    const dup = [
      "| Файл | Что покрывает | Тестов |",
      "|---|---|---|",
      "| `scripts/gate.test.mjs` | первая | 21 |",
      "| `scripts/gate.test.mjs` | вторая | 21 |",
    ].join("\n");
    const problems = checkInventoryRows("inv.md", dup, new Map([["scripts/gate.test.mjs", 21]]));
    expect(problems.map((p) => p.message)).toEqual(["scripts/gate.test.mjs: две строки в инвентаре"]);
  });

  it("правит число в строке с `\\|` и не дописывает вторую", () => {
    const table = [
      "## Скрипты гейтов — 1 файл, 0 тестов",
      "",
      "| Файл | Что покрывает | Тестов |",
      "|---|---|---|",
      "| `scripts/gate.test.mjs` | команда `npm test \\|\\| true` | 0 |",
    ].join("\n");
    const perFile = new Map([["scripts/gate.test.mjs", 21]]);
    const fixed = fixInventoryRows(table, perFile);
    expect(fixed).toContain("| `scripts/gate.test.mjs` | команда `npm test \\|\\| true` | 21 |");
    expect(fixed.match(/scripts\/gate\.test\.mjs/g)).toHaveLength(1);
    expect(fixInventoryRows(fixed, perFile)).toBe(fixed);
  });

  it("схлопывает дубль до одной строки", () => {
    const table = [
      "## Скрипты гейтов — 1 файл, 0 тестов",
      "",
      "| Файл | Что покрывает | Тестов |",
      "|---|---|---|",
      "| `scripts/gate.test.mjs` | первая | 0 |",
      "| `scripts/gate.test.mjs` | вторая | 0 |",
    ].join("\n");
    const perFile = new Map([["scripts/gate.test.mjs", 21]]);
    const fixed = fixInventoryRows(table, perFile);
    expect(fixed.match(/scripts\/gate\.test\.mjs/g)).toHaveLength(1);
    expect(fixed).toContain("| `scripts/gate.test.mjs` | первая | 21 |");
    expect(checkInventoryRows("inv.md", fixed, perFile)).toEqual([]);
  });
});
