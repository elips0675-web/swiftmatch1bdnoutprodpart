# Contributing — SwiftMatch

> Спасибо за интерес к проекту! Это руководство поможет внести вклад в SwiftMatch.

---

## Содержание

1. [Кодекс поведения](#кодекс-поведения)
2. [Как внести вклад](#как-внести-вклад)
3. [Настройка окружения](#настройка-окружения)
4. [Структура веток](#структура-веток)
5. [Стандарты кода](#стандарты-кода)
6. [Тестирование](#тестирование)
7. [Commit сообщения](#commit-сообщения)
8. [Pull Request](#pull-request)

---

## Кодекс поведения

- Будьте уважительны и конструктивны
- Принимайте конструктивную критику
- Фокусируйтесь на том, что лучше для проекта и сообщества
- Проявляйте эмпатию к другим участникам

---

## Как внести вклад

### Сообщить о баге

1. Проверьте, не создан ли уже Issue для этого бага
2. Создайте новый Issue с тегом `bug`
3. Заполните шаблон:
   - **Описание**: что происходит
   - **Шаги воспроизведения**: пошагово
   - **Ожидаемое поведение**: что должно было произойти
   - **Фактическое поведение**: что произошло на самом деле
   - **Окружение**: OS, браузер, версия Node.js
   - **Скриншоты / логи**: если применимо

### Предложить фичу

1. Проверьте, нет ли уже похожего Issue
2. Создайте Issue с тегом `enhancement`
3. Опишите:
   - Проблему, которую решает фича
   - Предлагаемое решение
   - Альтернативы (если есть)
   - Готовность помочь с реализацией

### Исправить баг / Реализовать фичу

1. Форкните репозиторий
2. Создайте ветку от `main` (см. [структуру веток](#структура-веток))
3. Внесите изменения
4. Напишите/обновите тесты
5. Убедитесь, что тесты проходят и сборка зелёная
6. Создайте Pull Request

---

## Настройка окружения

### Требования

- Node.js 20+
- MySQL 8.0+ (Laragon/XAMPP или локальный инстанс, порт 3306)
- Git
- PowerShell (Windows)

### Быстрый старт (рекомендуемый)

Проект рассчитан на запуск **только через `запуск-всего.bat`** из корня:

```bat
запуск-всего.bat
```

Что делает батник:
- Проверяет/поднимает MySQL (Laragon)
- Запускает API (Express) на `http://localhost:3002`
- Собирает фронт в production-режиме (`vite build && vite preview`) на `http://localhost:8081`
- Открывает браузер

> **Важно:** пути в `.bat` — только относительные (`%~dp0`). Хардкод путей (`D:\...`, `C:\...`) недопустим.

### Ручной запуск (только для разработки)

```bash
# 1. Зависимости
npm install
cd server && npm install && cd ..

# 2. Переменные окружения
cp .env.example .env
cp server/.env.example server/.env
# Заполните необходимые ключи (JWT_SECRET, DB_*)

# 3. База данных
# Создайте БД swiftmatch в MySQL (порт 3306), сидинг — скрипты в server/src

# 4. Запуск (dev)
# Терминал 1: API
cd server && npm run dev        # http://localhost:3002

# Терминал 2: фронт (dev с HMR)
npm run dev                      # http://localhost:8081, Vite proxy -> 3002

# Production-режим фронта (как в батнике)
npx vite build && npx vite preview --port 8081
```

---

## Структура веток

```text
main                    # Стабильная production-ветка
├── feature/xxx         # Новые фичи
├── bugfix/xxx          # Исправления багов
├── hotfix/xxx          # Срочные исправления
└── refactor/xxx        # Рефакторинг
```

Примеры имён:

```text
feature/i18n-parity-test
bugfix/profile-save-headers
hotfix/security-patch
refactor/mail-fallback
```

---

## Стандарты кода

### Общие правила

- **TypeScript strict** — никаких `any`
- **Комментарии в коде НЕ добавлять** (см. `docs/AGENTS-system-prompt.md`)
- **Минимальные изменения** — не делайте лишний рефакторинг вне задачи
- **Подготовленные SQL-запросы** — никакой конкатенации строк

### Frontend (React + Vite)

- Только функциональные компоненты с хуками
- Tailwind v3 + shadcn/ui (не Tailwind 4)
- i18n через `t('translation.key')` — сырые ключи пользователю запрещены
- Новые ключи добавляются в RU **и** EN в `src/context/language-context.tsx`

### Backend (Express + MySQL)

- Prepared statements (`?`, `??`) — обязательно
- Тонкие роуты: валидация → бизнес-логика → response
- Graceful degradation: Redis недоступен → тихий in-memory fallback, без 500
- `JWT_SECRET` через lazy getter в `server/src/middleware.js`
- `adminAuth` ACTIVE: единый гейт `/api/admin`, публичен только `GET /api/admin/features`

```js
// Хорошо: prepared statements
const [rows] = await pool.query(
  'SELECT id, email FROM users WHERE email = ? AND status = ?',
  [email, 'active']
)

// Плохо: конкатенация
await pool.query(`SELECT * FROM users WHERE email = '${email}'`)
```

### Именование

| Сущность | Стиль | Пример |
|---|---|---|
| Компоненты React | PascalCase | `ProfileEdit.tsx` |
| Хуки | camelCase + `use` | `useWebSocket.ts` |
| Утилиты | camelCase | `token.ts` |
| API-роуты | kebab-case в URL, camelCase в коде | `/api/auth/forgot-password` |
| Константы | UPPER_SNAKE_CASE | `MAX_FILE_SIZE` |
| Таблицы БД | snake_case | `user_profiles` |

---

## Тестирование

### Запуск тестов

```bash
# Фронтенд (Vitest)
npx vitest run

# Сервер (Vitest)
cd server && npm run test

# E2E (Playwright)
npm run test:e2e
```

> В PowerShell `npm`/`npx` блокируются — используйте `npm.cmd` / `npx.cmd`.

### Правила написания тестов

- AAA: Arrange → Act → Assert
- Описательные названия: `it('отправляет письмо напрямую без Redis')`
- Мокать внешние зависимости (ioredis, nodemailer, внешние API)
- E2E-пользователи — с префиксом `e2e_*` / `layout_*`; Playwright `globalTeardown` удаляет их из БД (FK CASCADE)
- После E2E в базе не должно оставаться мусора

### Гейты перед «готово» (обязательны)

```bash
npx tsc --noEmit              # TypeScript strict, 0 ошибок
npx eslint src/               # 0 ошибок (warnings допустимы)
npx vite build                # production-сборка проходит
npx vitest run                # фронт — все зелёные
cd server && npm run test     # сервер — все зелёные
```

---

## Commit сообщения

Формат — Conventional Commits:

```text
<type>(<scope>): <subject>

<body>

<footer>
```

| Тип | Описание |
|---|---|
| `feat` | Новая фича |
| `fix` | Исправление бага |
| `docs` | Документация |
| `style` | Форматирование (без изменения логики) |
| `refactor` | Рефакторинг |
| `test` | Тесты |
| `chore` | Сборка, зависимости, CI |
| `perf` | Производительность |
| `security` | Безопасность |

Примеры:

```text
fix(i18n): restore real parity test, add 12 missing keys
```

```text
fix(mail): send real email when Redis queue is unavailable
```

```text
fix(deps): nodemailer 9.0.1 -> 9.1.1 - closes runtime advisory
```

### Правила коммитов

- Коммиты по этапам: каждый логически завершённый этап — отдельный коммит
- После ручной проверки — `git commit --no-verify`
- **Не пушить без отдельной команды**
- **Никогда** не коммитить `.env` с секретами; `.env.example` — в репозитории

---

## Pull Request

### Чеклист

- [ ] Код соответствует стандартам (lint: 0 errors)
- [ ] TypeScript strict — нет `any`
- [ ] Гейты зелёные: `tsc --noEmit`, `eslint src/`, `vite build`, тесты (front + server)
- [ ] Новый функционал покрыт тестами
- [ ] Документация обновлена (`Что сделано.txt`, `Что доделать.txt`)
- [ ] Commit-сообщения соответствуют Conventional Commits
- [ ] PR направлен в `main`
- [ ] Нет конфликтов слияния

### Шаблон PR

```markdown
## Описание
Краткое описание изменений

## Тип изменения
- [ ] Bug fix
- [ ] Новая фича
- [ ] Рефакторинг
- [ ] Документация
- [ ] Тесты

## Как тестировать
1. Шаг 1
2. Шаг 2
3. Ожидаемый результат

## Связанные Issue
Closes #123

## Чеклист
- [ ] tsc --noEmit — 0 ошибок
- [ ] eslint src/ — 0 ошибок
- [ ] vite build — проходит
- [ ] тесты front + server — зелёные
```

---

*Последнее обновление: 26.09.2026*
