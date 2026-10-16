/**
 * Тесты гейта `scripts/check-alerts.mjs`.
 *
 * Половина файла — негативные кейсы: гейт ценен ровно тем, что краснеет на
 * дырах, которые закрывает (опечатка в имени метрики, забытый `rule_files`,
 * незамонтированный файл, заглушка вместо правила). Тест, который проверяет
 * только зелёный путь, доказывает ноль.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ALLOWED_SEVERITIES,
  allowedMetricNames,
  appMetricList,
  auditAlerts,
  composeMounts,
  metricsInExpr,
  parseRuleFile,
  parseScalar,
  ruleFilePaths,
  RULES_FILE,
  RULES_MOUNT,
  splitKv,
  stripComment,
  validateRules,
} from "./check-alerts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const METRICS_SRC = [
  "const a = new client.Counter({",
  "  name: 'http_requests_total',",
  "})",
  "const b = new client.Histogram({",
  "  name: 'http_request_duration_seconds',",
  "})",
  "const c = new client.Histogram({",
  "  name: 'db_query_duration_seconds',",
  "})",
  "const d = new client.Gauge({",
  "  name: 'queue_jobs',",
  "})",
  "const e = new client.Counter({",
  "  name: 'cache_hits_total',",
  "})",
  "const f = new client.Counter({",
  "  name: 'cache_misses_total',",
  "})",
].join("\n");

const RULES = [
  "groups:",
  "  - name: swiftmatch-api",
  "    rules:",
  "      - alert: ApiDown",
  "        expr: 'up{job=\"swiftmatch-api\"} == 0'",
  "        for: 2m",
  "        labels:",
  "          severity: critical",
  "        annotations:",
  "          summary: API down",
  "          description: up is zero for two minutes",
  "      - alert: SlowApi",
  "        expr: 'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le)) > 1'",
  "        for: 10m",
  "        labels:",
  "          severity: warning",
  "        annotations:",
  "          summary: Slow API",
  "          description: p95 above one second",
].join("\n");

const PROM = [
  "global:",
  "  scrape_interval: 15s",
  "",
  "rule_files:",
  `  - ${RULES_MOUNT}`,
  "",
  "scrape_configs:",
  "  - job_name: 'swiftmatch-api'",
].join("\n");

const COMPOSE = [
  "services:",
  "  prometheus:",
  "    volumes:",
  `      - ./${RULES_FILE}:${RULES_MOUNT}`,
  "      - prometheus_data:/prometheus",
].join("\n");

const audit = (over = {}) => auditAlerts({
  ruleText: RULES,
  prometheusText: PROM,
  composeText: COMPOSE,
  metricsSource: METRICS_SRC,
  ...over,
});

describe("stripComment / parseScalar / splitKv", () => {
  it("срезает комментарий вне кавычек и не трогает внутри", () => {
    expect(stripComment("expr: 'a # b' # хвост")).toBe("expr: 'a # b' ");
    expect(stripComment("groups: # комментарий")).toBe("groups: ");
    expect(stripComment("plain line")).toBe("plain line");
  });

  it("снимает парные кавычки, plain возвращает как есть", () => {
    expect(parseScalar("'x y'")).toBe("x y");
    expect(parseScalar('"x y"')).toBe("x y");
    expect(parseScalar("x y")).toBe("x y");
    expect(parseScalar("'")).toBe("'");
  });

  it("разбирает пару «ключ: значение» и отличает от порта", () => {
    expect(splitKv("expr: up == 0")).toEqual({ key: "expr", value: "up == 0" });
    expect(splitKv("rules:")).toEqual({ key: "rules", value: "" });
    expect(splitKv("9090:9090")).toBeNull();
    expect(splitKv("a: b: c")).toEqual({ key: "a", value: "b: c" });
  });
});

describe("parseRuleFile", () => {
  it("разбирает наш формат в группы и правила", () => {
    const { groups, errors } = parseRuleFile(RULES);
    expect(errors).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("swiftmatch-api");
    expect(groups[0].rules.map((r) => r.alert)).toEqual(["ApiDown", "SlowApi"]);
    expect(groups[0].rules[0].expr).toBe('up{job="swiftmatch-api"} == 0');
    expect(groups[0].rules[0].labels).toEqual({ severity: "critical" });
    expect(groups[0].rules[1].annotations.summary).toBe("Slow API");
  });

  it("краснеет на неизвестном поле правила, а не пропускает его", () => {
    const text = RULES.replace("        for: 2m", "        unknown: 2m");
    const { errors } = parseRuleFile(text);
    expect(errors.some((e) => e.includes("неизвестное поле правила «unknown»"))).toBe(true);
  });

  it("краснеет на неожиданном отступе", () => {
    const text = RULES.replace("        for: 2m", "       for: 2m");
    const { errors } = parseRuleFile(text);
    expect(errors.some((e) => e.includes("неожиданный отступ 7"))).toBe(true);
  });

  it("краснеет на flow-стиле вместо блока", () => {
    const { errors } = parseRuleFile("groups: []");
    expect(errors.some((e) => e.includes("на верхнем уровне ожидалось «groups:»"))).toBe(true);
  });
});

describe("validateRules", () => {
  it("требует severity, for, summary и description", () => {
    const bare = parseRuleFile([
      "groups:",
      "  - name: g",
      "    rules:",
      "      - alert: X",
      "        expr: 'up == 0'",
    ].join("\n")).groups;
    const problems = validateRules(bare);
    expect(problems.some((p) => p.includes("нет for"))).toBe(true);
    expect(problems.some((p) => p.includes("нет labels.severity"))).toBe(true);
    expect(problems.some((p) => p.includes("нет annotations.summary"))).toBe(true);
    expect(problems.some((p) => p.includes("нет annotations.description"))).toBe(true);
  });

  it("ловит severity вне списка и повтор имени", () => {
    const g = parseRuleFile([
      "groups:",
      "  - name: g",
      "    rules:",
      "      - alert: X",
      "        expr: 'up == 0'",
      "        for: 1m",
      "        labels:",
      "          severity: blocker",
      "        annotations:",
      "          summary: s",
      "          description: d",
      "      - alert: X",
      "        expr: 'up == 0'",
      "        for: 1m",
      "        labels:",
      "          severity: info",
      "        annotations:",
      "          summary: s",
      "          description: d",
    ].join("\n")).groups;
    const problems = validateRules(g);
    expect(problems.some((p) => p.includes(`severity «blocker» вне ${ALLOWED_SEVERITIES.join("/")}`))).toBe(true);
    expect(problems.some((p) => p.includes("имя повторяется"))).toBe(true);
  });

  it("пустой файл правил — проблема, а не тишина", () => {
    expect(validateRules([])).toEqual(["в файле нет ни одной группы правил"]);
  });
});

describe("metricsInExpr", () => {
  it("берёт только метрики, а не функции и метки", () => {
    expect(metricsInExpr('up{job="swiftmatch-api"} == 0')).toEqual(["up"]);
    expect(metricsInExpr('sum(rate(http_requests_total{status=~"5.."}[5m])) / clamp_min(sum(rate(http_requests_total[5m])), 1) > 0.05'))
      .toEqual(["http_requests_total"]);
    expect(metricsInExpr('histogram_quantile(0.95, sum(rate(db_query_duration_seconds_bucket[5m])) by (le)) > 0.5'))
      .toEqual(["db_query_duration_seconds_bucket"]);
    expect(metricsInExpr('sum(queue_jobs{state="waiting"}) > 100')).toEqual(["queue_jobs"]);
    expect(metricsInExpr("process_resident_memory_bytes > 1.5e9")).toEqual(["process_resident_memory_bytes"]);
    expect(metricsInExpr("sum(rate(cache_hits_total[15m])) + sum(rate(cache_misses_total[15m]))"))
      .toEqual(["cache_hits_total", "cache_misses_total"]);
    expect(metricsInExpr("")).toEqual([]);
  });
});

describe("appMetricList / allowedMetricNames", () => {
  it("читает типы и имена из кода", () => {
    expect(appMetricList(METRICS_SRC)).toEqual([
      { type: "counter", name: "http_requests_total" },
      { type: "histogram", name: "http_request_duration_seconds" },
      { type: "histogram", name: "db_query_duration_seconds" },
      { type: "gauge", name: "queue_jobs" },
      { type: "counter", name: "cache_hits_total" },
      { type: "counter", name: "cache_misses_total" },
    ]);
  });

  it("разрешает производные гистограмм, но не выдумывает их для счётчиков", () => {
    const allowed = allowedMetricNames(appMetricList(METRICS_SRC));
    expect(allowed.has("http_request_duration_seconds_bucket")).toBe(true);
    expect(allowed.has("http_request_duration_seconds_count")).toBe(true);
    expect(allowed.has("queue_jobs")).toBe(true);
    expect(allowed.has("queue_jobs_bucket")).toBe(false);
    expect(allowed.has("up")).toBe(true);
  });
});

describe("ruleFilePaths / composeMounts", () => {
  it("вытаскивает rule_files и монтирования", () => {
    expect(ruleFilePaths(PROM)).toEqual([RULES_MOUNT]);
    expect(composeMounts(COMPOSE).get(RULES_FILE)).toBe(RULES_MOUNT);
    expect(ruleFilePaths("global:\n  scrape_interval: 15s")).toEqual([]);
  });
});

describe("auditAlerts", () => {
  it("на правильном наборе молчит", () => {
    expect(audit()).toEqual([]);
  });

  it("краснеет на опечатке в имени метрики", () => {
    const broken = RULES.replace("http_request_duration_seconds_bucket", "http_request_duration_second_bucket");
    const problems = audit({ ruleText: broken });
    expect(problems.some((p) => p.includes("метрика «http_request_duration_second_bucket» не объявлена"))).toBe(true);
  });

  it("краснеет, когда rule_files не подключает файл правил", () => {
    const problems = audit({ prometheusText: "global:\n  scrape_interval: 15s\n" });
    expect(problems.some((p) => p.includes("rule_files не перечисляет"))).toBe(true);
  });

  it("краснеет, когда файл правил не смонтирован", () => {
    const problems = audit({ composeText: "services:\n  prometheus:\n    volumes:\n      - prometheus_data:/prometheus\n" });
    expect(problems.some((p) => p.includes("не смонтирован"))).toBe(true);
    expect(problems.some((p) => p.includes("нет монтирования"))).toBe(true);
  });

  it("краснеет, когда парсер метрик перестал понимать код", () => {
    const problems = audit({ metricsSource: "const a = 1\n" });
    expect(problems.some((p) => p.includes("распознано 0 объявлений метрик"))).toBe(true);
  });
});

describe("репозиторий", () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

  it("настоящие файлы проходят гейт", () => {
    expect(auditAlerts({
      ruleText: read(RULES_FILE),
      prometheusText: read("monitoring/prometheus.yml"),
      composeText: read("docker-compose.yml"),
      metricsSource: read("server/src/metrics.js"),
    })).toEqual([]);
  });

  it("в файле правил восемь правил и три уровня важности", () => {
    const { groups, errors } = parseRuleFile(read(RULES_FILE));
    expect(errors).toEqual([]);
    const rules = groups.flatMap((g) => g.rules);
    expect(rules).toHaveLength(8);
    expect(new Set(rules.map((r) => r.labels.severity))).toEqual(new Set(ALLOWED_SEVERITIES));
    for (const r of rules) expect(metricsInExpr(r.expr).length).toBeGreaterThan(0);
  });
});
