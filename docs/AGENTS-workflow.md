# Итеративный подход к задачам (5 этапов)

Каждая задача проходит 5 этапов:

## Этап 0 — Чтение кода (Code Reading)
1. Найти все релевантные файлы по теме (grep/glob)
2. Прочитать текущую реализацию: импорты, типы, API-контракт
3. Понять архитектуру: data flow, кто вызывает, кто потребляет
4. Проверить существующие тесты — что уже покрыто
5. Если баг — воспроизвести условие (логи, тесты, curl)

## Этап 1 — Планирование (Plan)
1. Определить границы задачи: что входит, что НЕ входит
2. Выбрать архитектурное решение (1-2 предложения)
3. Составить список изменений: какие файлы создавать/менять
4. Проверить консистентность: не сломает ли изменение соседние модули
5. Если production — прогнать Pre-flight Checklist

## Этап 2 — Реализация (Implement)
1. Сначала типы/интерфейсы (TypeScript strict, никаких any)
2. Потом data layer (API, SQL, Context, Query)
3. Потом UI (презентационные компоненты без логики)
4. Потом связка (state management + side effects)
5. Каждый коммит — одна атомарная логическая единица
6. Conventional Commits: feat:, fix:, refactor:, test:, docs:, chore:

## Этап 3 — Тестирование (Test)
1. Unit-тесты на новую логику (Vitest + RTL)
2. Интеграционные: API через curl/Playwright
3. E2E: критические user flows (регистрация → лайк → чат)
4. Проверка edge cases: пустые данные, ошибки, лимиты
5. `npx vite build` — сборка без ошибок
6. `npm run test` + `cd server && npm run test` — 0 failures
7. `npx playwright test` — 0 failures

## Этап 4 — Верификация (Verify)
1. Проверить, что старые тесты не упали
2. Проверить консоль браузера — нет ошибок
3. Проверить Network tab — правильные статусы
4. Если production — Security grep (хардкодные секреты, порты)
5. Обновить документацию (context.txt, AGENTS.md, persona.md при необходимости)
6. `git push` только когда всё зелёное

---

# Prompt Templates for AI-ассистентов

## Создание компонента
```
Создай production-ready компонент [Название]:
- Props interface с JSDoc
- ForwardRef для форм
- Tailwind через cn()
- Loading + error состояния
- ARIA-атрибуты
- Контекст дизайн-системы из project-context.md
```

## Оптимизация
```
Проанализируй компонент на:
1. Ненужные re-renders (React.memo, useMemo, useCallback)
2. Bundle size (tree-shaking, dynamic imports)
3. Tailwind классы (конфликты, дублирование)
4. TypeScript strictness (any, type assertions)
Верни оптимизированную версию.
```

## Итеративный подход к фичам
1. Сначала архитектура: структура папок и data flow
2. Потом типы: TypeScript types и API contracts
3. Затем UI: презентационные компоненты без логики
4. Потом логика: state management + side effects
5. Наконец тесты: критические пути
