const fs = require('fs')

const donePath = 'Что сделано.txt'
let done = fs.readFileSync(donePath, 'utf8')
const lines = done.split('\n')
const record = "(Stage 132 — COV-03, часть 10: `shutdown.js` и `cleanup.js` — graceful shutdown и фоновая очистка доведены до 100/100/100, 20.10.2026) — **Десятый этап очереди: два инфраструктурных модуля, которые живут на самом краю процесса.** `shutdown.js` — graceful shutdown (сигнал → закрытие ресурсов по порядку → exit), `cleanup.js` — фоновая очистка revoked-токенов и старых уведомлений (таблицы растут линейно от активности). До этапа: `shutdown.js` **96.15 st / 80 br / 80 fn / 95.65 lines** (не покрыты дефолтный `exit` в сигнатуре `:9` и `err.message`-fallback для не-Error в логе `:37`), `cleanup.js` **88.57 st / 80.95 br / 77.77 fn** (не покрыты fallback `?? 0` при БД без `affectedRows` `:19,29`, ранний возврат повторного `start*` `:38,47` и обе `.catch`-стрелки таймеров `:40,49`).\n\nШесть тестов (по три в каждый файл: `shutdown.test.js` 5 → 8, `cleanup.test.js` 10 → 13) выводят оба модуля на **100 / 100 / 100**: shutdown — не-Error исключение (`throw 'boom'`) логируется строкой и не роняет очистку, дефолтный `exit` реально зовёт `process.exit(0)` (проверено через `vi.spyOn`), `deadline` без `unref`-метода не бросает; cleanup — БД, вернувшая `[undefined]`, даёт `0`, а не `NaN`/throw, повторный `startRefreshTokenCleanup`/`startNotificationCleanup` возвращают **тот же таймер**, а не плодят второй, сбой purge внутри таймера ловится `.catch` и не всплывает как unhandledRejection.\n\n**Проверено обратной подстановкой (четыре слома, каждый — одна строка):** `err.message ? err.message : err` → голое `err.message` роняет тест не-Error; дефолтный `exit` → пустая стрелка роняет тест `process.exit`; удаление `?? 0` роняет тест «БД без affectedRows»; снятие `if (refreshTimer) return refreshTimer` роняет тест повторного start. После откатов `shutdown.js` и `cleanup.js` **побайтово равны HEAD** (`git diff` пуст). Итог сервера: **93.81 / 91.88 / 92.89 / 93.78 %**, **2503 тестов** (144 файла), exit 0; пороги `server/vitest.config.js` (91/89/90/91) не менялись — «факт − 2» = 91.81 / 89.88 / 90.89 / 91.78, целый пункт вверх не перешагнут.\n"
lines.splice(3, 0, record)
fs.writeFileSync(donePath, lines.join('\n'), 'utf8')

const backlogPath = 'Что доделать.txt'
let backlog = fs.readFileSync(backlogPath, 'utf8')

const oldQueue = "`middleware/adminAuth.js` **100 / 100 / 100** (Stage 131 — гейт админки: пустой токен в `decodeAny`, null-строки команд без warn, ошибка БД → 500 `ADMIN_CHECK_FAILED`). Ниже остальных остались не-security модули (`shutdown.js` 80 br, `cleanup.js` 80.95 br, `queue.js` 81.25 br) — брать после, приоритет у security/money; security/money из списка закрыты."
const newQueue = "`middleware/adminAuth.js` **100 / 100 / 100** (Stage 131 — гейт админки: пустой токен в `decodeAny`, null-строки команд без warn, ошибка БД → 500 `ADMIN_CHECK_FAILED`), `shutdown.js` **100 / 100 / 100** (Stage 132 — graceful shutdown: дефолтный `exit`, не-Error в логе, таймер без `unref`), `cleanup.js` **100 / 100 / 100** (Stage 132 — фоновая очистка: `?? 0` при БД без `affectedRows`, повторный `start*` возвращает тот же таймер, сбой purge в `.catch`). Ниже остальных остались не-security модули (`queue.js` 81.25 br, `queue-monitor.js` 87.5 br) — брать после, приоритет у security/money; security/money из списка закрыты."
if (!backlog.includes(oldQueue)) throw new Error('queue anchor not found')
backlog = backlog.replace(oldQueue, newQueue)

const oldRule = "сервер **93.74 / 91.72 / 92.53 / 93.77 %** (Stage 131) → пороги **91 / 89 / 90 / 91** («факт − 2» = 91.74 / 89.72 / 90.53 / 91.77; Stage 126 поднял ветки 88 → **89**; Stage 127–131 пороги не меняли — ни одна метрика не перешагнула целый пункт вверх; ветки 91.72 держат потолок из «факт − 2» ниже 90, поэтому 89 остаётся)"
const newRule = "сервер **93.81 / 91.88 / 92.89 / 93.78 %** (Stage 132) → пороги **91 / 89 / 90 / 91** («факт − 2» = 91.81 / 89.88 / 90.89 / 91.78; Stage 126 поднял ветки 88 → **89**; Stage 127–132 пороги не меняли — ни одна метрика не перешагнула целый пункт вверх; ветки 91.88 держат потолок из «факт − 2» ниже 90, поэтому 89 остаётся)"
if (!backlog.includes(oldRule)) throw new Error('rule anchor not found')
backlog = backlog.replace(oldRule, newRule)

fs.writeFileSync(backlogPath, backlog, 'utf8')
console.log('OK')
