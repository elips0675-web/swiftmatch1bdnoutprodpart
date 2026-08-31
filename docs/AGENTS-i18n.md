# i18n: Golden Rules (переводы и translation keys)

## Golden Rule: Never display raw translation keys

Every value displayed to the user MUST be wrapped in `t()`:

- Interests: `{t(interest)}` — key is `"interest.sport"`, displays `"Спорт"` (RU) / `"Sports"` (EN)
- Goals: `{t(profile.datingGoal)}` — key is `"goal.serious_relationship"`, displays `"Серьезные отношения"` / `"Serious relationship"`
- Zodiac: `{t(user.zodiac)}` — key is `"common.zodiac.leo"`, displays `"Лев"` / `"Leo"`
- Education: `{t(profile.education)}` — key is `"education.higher"`, displays `"Высшее"` / `"Higher education"`

## Data format convention

All data stored in DB, localStorage, demo-data, and state MUST use **translation keys**, not Russian or English display strings:

| OK | NOT OK |
|---|---|
| `"interest.photography"` | `"Фотография"` or `"Photography"` |
| `"goal.serious_relationship"` | `"Серьезные отношения"` or `"Serious relationship"` |
| `"common.zodiac.leo"` | `"Лев"` or `"Leo"` |

This ensures:
1. `t()` can always find a translation in any language
2. Comparisons (e.g. autosearch filters) always match regardless of language
3. Adding a new language doesn't require changing data

## Available translation keys

| Prefix | Defined in | Example |
|---|---|---|
| `interest.*` | `constants.ts` → `INTEREST_OPTIONS` | `"interest.sport"` |
| `goal.*` | `constants.ts` → `DATING_GOALS` | `"goal.serious_relationship"` |
| `common.zodiac.*` | `constants.ts` → `ZODIAC_SIGNS` | `"common.zodiac.leo"` |
| `education.*` | `constants.ts` → `EDUCATION_OPTIONS` | `"education.higher"` |
| `circadian.*` | `constants.ts` → `CIRCADIAN_RHYTHM_OPTIONS` | `"circadian.early_bird"` |
| `attach.*` | `attachment-styles.ts` | `"attach.style.secure.label"` |
| `chats.theme.*` | `chats.tsx` → `CHAT_THEMES` | `"chats.theme.romantic"` |

## Data Rules (реализация)

- **Всё** в БД, localStorage, state — translation keys (`interest.sport`, не `"Спорт"`)
- UI-тексты обязательно через `t()` — ни один raw key не должен быть виден пользователю
- Сортировка translated-списков: `t(item).localeCompare(t(item2))`
- Новые сущности: key в `constants.ts` + запись в `language-context.tsx` (RU и EN)
- Исключение: админка и Sentry-логи — технические ID (`user_123`), не `t()`

## Где лежат переводы

Реальная i18n-система — inline `translations` в `src/context/language-context.tsx` (RU-блок, затем EN-блок, объект закрывается в конце файла). `t()` ищет в `translations[language]`, фолбэк на EN, затем на ключ; `{key}`-подстановка через options.

> ВАЖНО: файлы `src/locales/ru.json`/`en.json` — ОСИРОТЕВШИЕ, никто их не импортирует. Добавлять ключи только в `language-context.tsx`.

При добавлении нового ключа всегда добавлять и RU, и EN. При добавлении контента в БД через админку — синхронизировать переводы (иначе админка покажет сырые ключи).
