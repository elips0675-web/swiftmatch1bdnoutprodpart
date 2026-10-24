-- 072: типы приглашений picnic/exhibition/museum в ENUM invites.invite_type.
--
-- Зачем: src/pages/user.tsx предлагает семь вариантов приглашения (кофе, кино,
-- прогулка, ужин, пикник, выставка, музей), а сервер
-- server/src/routes/social.js принимал только coffee/cinema/walk/dinner/other.
-- До этого этапа фронт вообще не звал POST /api/invites и сохранял приглашение
-- в localStorage, поэтому расхождение не всплывало; после подключения реального
-- API пикник, выставка и музей получали бы 400 "Invalid invite type", а запись
-- в ENUM отклонила бы значение 500-й ошибкой.
--
-- Дрейф схемы: то же объявление есть в database/mysql_schema.sql (эталон,
-- таблица invites) — гейт scripts/schema-drift-audit.mjs сверяет код со схемой.
-- Гейт scripts/check-enum-constraints.mjs держит список INVITE_TYPES не шире
-- этого ENUM.
--
-- Идемпотентно: MODIFY COLUMN с тем же определением повторно ничего не меняет.

ALTER TABLE `invites`
  MODIFY COLUMN `invite_type` enum('coffee','cinema','walk','dinner','picnic','exhibition','museum','other') COLLATE utf8mb4_unicode_ci NOT NULL;
