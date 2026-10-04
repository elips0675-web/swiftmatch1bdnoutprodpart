/**
 * Тесты гейта `scripts/secrets-leak-audit.mjs` — третий канал, «значения в текстах».
 *
 * Первые два канала смотрят на ИМЯ файла, поэтому секрет, вписанный значением в
 * обычный `README.md`, для них был невидим: `README.md:371` в блоке «Настройка
 * .env» держал настоящий `VAPID_PRIVATE_KEY=b370…`, и он уехал на GitHub вместе
 * с историей, пока гейт был зелёный. Тесты ниже фиксируют обе границы нового
 * канала: настоящий секрет обязан ломать гейт, а плейсхолдеры (`.env.example`,
 * шаблоны, тестовые константы в workflow) — обязаны оставаться зелёными, иначе
 * гейт отключат за шум.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  compileRsyncPattern,
  findContentSecrets,
  findRsyncSecretGaps,
  isExcluded,
  isSecretPath,
  parseDockerignore,
  parseRsyncExcludes,
  SECRET_FILE_SAMPLES,
} from "./secrets-leak-audit.mjs";

let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "secrets-audit-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

const hits = (rel) => findContentSecrets(root).filter((h) => h.file === rel);

const VAPID = "b370faewrsuKX2yUXBZ-2-axZiScdesTmpXHPq0yJN4";
const JWT64 = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";
// Токены ниже склеиваются из частей: push protection GitHub (GH013) отклоняет
// пуш, в котором лежит непрерывный литерал вида sk_live_<16+>. На тест это не
// влияет — гейт получает в файле ровно тот же токен, что и настоящий.
const STRIPE = ["sk_", "live_abcdefghij0123456789ABCD"].join("");

describe("findContentSecrets: настоящие секреты", () => {
  it("ловит VAPID-приватный ключ в README (тот самый исторический случай)", () => {
    write("README.md", `\`\`\`\nVAPID_PRIVATE_KEY=${VAPID}\n\`\`\`\n`);
    const found = hits("README.md");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].line).toBe(2);
    expect(found.some((h) => h.rule === "VAPID private key")).toBe(true);
  });

  it("ловит ключ OpenAI, Stripe live, AWS, GitHub и PEM-блок", () => {
    write("a.md", "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH");
    write("b.txt", STRIPE);
    write("c.json", '"AKIAIOSFODNN7EXAMPLE"');
    write("d.md", "ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    write("e.txt", "-----BEGIN RSA PRIVATE KEY-----");
    const rules = findContentSecrets(root).map((h) => h.rule);
    expect(rules).toContain("ключ OpenAI");
    expect(rules).toContain("живой ключ Stripe");
    expect(rules).toContain("AWS access key id");
    expect(rules).toContain("токен GitHub");
    expect(rules).toContain("приватный ключ PEM");
  });

  it("ловит присваивание секрета длинным значением", () => {
    write("notes.md", `JWT_SECRET=${JWT64}\n`);
    expect(hits("notes.md").some((h) => h.rule === "присваивание секрета")).toBe(true);
  });

  it("находит вложенные файлы и указывает номер строки", () => {
    write("docs/честный.md", "text\nJWT_SECRET=" + JWT64 + "\nmore\n");
    const found = hits("docs/честный.md");
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(2);
  });
});

describe("findContentSecrets: что секретом быть не должно", () => {
  it("плейсхолдеры в .env.example и .example — зелёные", () => {
    write(".env.example", "JWT_SECRET=change-me-to-a-long-random-secret\n");
    write("server/.env.example", "VAPID_PRIVATE_KEY=change-me-generate-with-web-push\n");
    write("config.conf", "DSN=https://token@example.invalid/1234567890\n");
    expect(findContentSecrets(root)).toEqual([]);
  });

  it("слово «example» внутри настоящего токена не делает его плейсхолдером", () => {
    write("c.json", '"AKIAIOSFODNN7EXAMPLE"');
    expect(hits("c.json").some((h) => h.rule === "AWS access key id")).toBe(true);
  });

  it("чтение переменной в коде (`process.env.X`) — не присваивание", () => {
    write("server/src/routes/push.js", "const key = process.env.VAPID_PRIVATE_KEY || ''\n");
    expect(findContentSecrets(root)).toEqual([]);
  });

  it("тестовые константы в workflow — зелёные", () => {
    write(".github/workflows/ci.yml", [
      "        env:",
      "          JWT_SECRET: ci-e2e-jwt-secret",
      "          MYSQL_ROOT_PASSWORD: swiftmatch_test",
      "          DB_PASSWORD: swiftmatch_test",
    ].join("\n"));
    expect(findContentSecrets(root)).toEqual([]);
  });

  it("плейсхолдеры с ${VAR} и подстановкой — зелёные", () => {
    write("docker-compose.yml", "MYSQL_ROOT_PASSWORD: ${MYSQL_PASSWORD:-swiftmatch}\n");
    expect(findContentSecrets(root)).toEqual([]);
  });

  it("двоичные и нечитаемые расширения не сканируются", () => {
    write("logo.png", VAPID);
    write("seed.sql", `INSERT INTO t VALUES ('${JWT64}');`);
    expect(findContentSecrets(root)).toEqual([]);
  });
});

describe("findContentSecrets: обход дерева", () => {
  it("пропускает node_modules, dist и .git", () => {
    write("node_modules/pkg/README.md", `VAPID_PRIVATE_KEY=${VAPID}\n`);
    write("dist/bundle.js", `VAPID_PRIVATE_KEY=${VAPID}\n`);
    write(".git/config", `VAPID_PRIVATE_KEY=${VAPID}\n`);
    write("README.md", "чисто\n");
    expect(findContentSecrets(root)).toEqual([]);
  });

  it("сортирует находки по файлу и строке", () => {
    write("b.md", "JWT_SECRET=" + JWT64 + "\nJWT_SECRET=" + JWT64 + "\n");
    write("a.md", "JWT_SECRET=" + JWT64 + "\n");
    const found = findContentSecrets(root);
    expect(found.map((h) => `${h.file}:${h.line}`)).toEqual(["a.md:1", "b.md:1", "b.md:2"]);
  });
});

describe("parseDockerignore: семантика полного пути", () => {
  it("`.env` исключает только корневой файл, `**/.env` — все", () => {
    const rules = parseDockerignore(".env\n**/.env\n");
    expect(isExcluded(".env", false, rules)).toBe(true);
    expect(isExcluded("server/.env", false, rules)).toBe(true);
    expect(isExcluded(".env", false, parseDockerignore(".env\n"))).toBe(true);
    expect(isExcluded("server/.env", false, parseDockerignore(".env\n"))).toBe(false);
  });
});

// rsync-канал. Дыра этапа 35: `server/.jwt-dev-secret` закрыт .gitignore и
// .dockerignore, но не матчился НИ ОДНИМ `--exclude` в deploy.yml — и ехал на
// VPS, пока гейт был зелёный: список обязательных исключений был константой
// гейта, а не тем, что гейт сам считает секретом.
const RSYNC_SWITCHES_BEFORE_STAGE_35 =
  "-avz --delete --exclude node_modules --exclude .git --exclude test-results --exclude playwright-report " +
  "--exclude e2e/.auth --exclude .env --exclude '*.secret' --exclude '*.pem' --exclude '*.key' --exclude '*.p12' --exclude uploads";

const rsyncYml = (switches) =>
  `  deploy:\n    steps:\n      - uses: actions/checkout@v4\n      - name: rsync\n        with:\n          switches: ${switches}\n`;

const gapsOf = (switches) => findRsyncSecretGaps(rsyncYml(switches));

describe("parseRsyncExcludes: разбор строки switches", () => {
  it("берёт значения --exclude с кавычками и без, пробелом и равенством", () => {
    expect(parseRsyncExcludes("-avz --exclude node_modules --exclude '*.secret' --exclude=\"*.pem\"")).toEqual([
      "node_modules",
      "*.secret",
      "*.pem",
    ]);
  });

  it("пустая строка switches не превращается в тысячу исключений", () => {
    expect(parseRsyncExcludes("")).toEqual([]);
  });
});

describe("compileRsyncPattern: семантика rsync, а не docker", () => {
  const matches = (pattern, sample) => {
    const rule = compileRsyncPattern(pattern);
    return rule.re.test(rule.byPath ? sample : sample.split("/").pop());
  };

  it("шаблон без слеша матчит basename на любой глубине", () => {
    expect(matches(".env", ".env")).toBe(true);
    expect(matches(".env", "server/.env")).toBe(true);
    expect(matches("*.secret", "server/.jwt-dev-secret")).toBe(false);
    expect(matches("*-secret", "server/.jwt-dev-secret")).toBe(true);
  });

  it("звёздочка не проходит через слеш, шаблон со слешем сверяет путь от корня", () => {
    expect(matches("uploads", "server/uploads")).toBe(true);
    expect(matches("config/*.pem", "config/tls.pem")).toBe(true);
    expect(matches("config/*.pem", "server/config/tls.pem")).toBe(false);
    expect(matches("*.key", "nested/dir/tls.key")).toBe(true);
    expect(matches("*.key", "nested/dir/tls.key/внутри")).toBe(false);
  });
});

describe("findRsyncSecretGaps: дыра rsync, которую не видели два канала", () => {
  it("на рабочем deploy.yml находок нет (контрольный зелёный)", () => {
    const deployYml = fs.readFileSync(
      path.join(process.cwd(), ".github/workflows/deploy.yml"),
      "utf8",
    );
    expect(findRsyncSecretGaps(deployYml)).toEqual([]);
  });

  it("на строке rsync до этапа 35 без исключений не находятся (старый гейт был зелёный)", () => {
    const legacy = parseRsyncExcludes(RSYNC_SWITCHES_BEFORE_STAGE_35);
    expect(legacy).toEqual([
      "node_modules", ".git", "test-results", "playwright-report",
      "e2e/.auth", ".env", "*.secret", "*.pem", "*.key", "*.p12", "uploads",
    ]);
    const gaps = gapsOf(RSYNC_SWITCHES_BEFORE_STAGE_35);
    expect(gaps).toContain(".jwt-dev-secret");
    expect(gaps).toContain(".env.local");
    expect(gaps).toContain("tls.pfx");
    expect(gaps).toContain("id_rsa");
    expect(gaps).toContain("id_ed25519");
    expect(gaps.length).toBe(7);
  });

  it("без исключения для дев-секрета дыра ровно в .jwt-dev-secret", () => {
    const fixed = fs.readFileSync(path.join(process.cwd(), ".github/workflows/deploy.yml"), "utf8");
    const switches = fixed.match(/^\s*switches:\s*(.+)$/m)[1].trim();
    expect(gapsOf(switches.replace(/ --exclude '\*-secret'/, ""))).toEqual([".jwt-dev-secret"]);
  });

  it("без `.env.*` теряются все варианты окружения, а `.env` остаётся", () => {
    const fixed = fs.readFileSync(path.join(process.cwd(), ".github/workflows/deploy.yml"), "utf8");
    const switches = fixed.match(/^\s*switches:\s*(.+)$/m)[1].trim();
    expect(gapsOf(switches.replace(/ --exclude '\.env\.\*'/, "")).sort()).toEqual([
      ".env.development", ".env.local", ".env.production",
    ]);
  });

  it("каждый образец признан секретом самим isSecretPath (списки не разъедутся)", () => {
    for (const sample of SECRET_FILE_SAMPLES) {
      expect(isSecretPath(sample)).toBe(true);
      expect(isSecretPath(`server/${sample}`)).toBe(true);
    }
    expect(isSecretPath(".env.example")).toBe(false);
    expect(isSecretPath("server/.env.example")).toBe(false);
  });
});
