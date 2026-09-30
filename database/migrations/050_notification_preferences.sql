-- 050: Notification preferences per user (P0 #4) — какие события и по каким каналам
-- получать уведомления. Одна строка на пользователя, матрица 9 событий x 2 канала.
-- Канон: БД хранит ТОЛЬКО ключи (event -> channel -> bool), без текстов;
-- подписи событий живут в i18n (language-context.tsx), пустые ячейки = "по умолчанию включено".
--
-- Отсутствие строки у пользователя = все уведомления включены (fail-open):
-- старые аккаунты и новые юзеры не теряют уведомления из-за отсутствия миграции.
--
-- Каналы по факту кода (6 INSERT в notifications + 8 вызовов sendPushToUser):
--   like, invite, hangout_cancelled, hangout_response, hangout_accepted,
--   hangout_declined, hangout_mutual_like, hangout_joined, chat_message
-- Email по этим событиям не отправляется ни разу, поэтому канала ровно два:
-- in-app (таблица notifications) и push (FCM / web-push).

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id INT UNSIGNED NOT NULL,
  prefs JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT notification_preferences_ibfk_1
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
