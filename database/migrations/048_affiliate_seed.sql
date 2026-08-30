-- 048: Affiliate-блок «Куда пойти» (этап 90) — демо-офферы dining/travel/gift для пары.
-- Расширяет партнёрские офферы категорий restaurant/hotel/flowers/taxi/gift (enum уже содержит их)
-- с непустым deeplink — эндпоинт GET /api/affiliate/offers фильтрует именно такие.
-- Комиссия задаётся на уровне партнёра (partner.commission_rate 5–15%), здесь только аффилиат-данные.
-- Идемпотентно: вставляет только если оффера с таким title ещё нет.

-- Ресторан первого свидания (Restoclub, commission 12%)
INSERT INTO partner_offers (partner_id, category, title, description, image_url, deeplink, price, city, placement, status, valid_to)
SELECT p.id, 'restaurant', 'Ресторан для первого свидания', 'Уютные рестораны с атмосферой для свидания: подборка по городу, бронь столика в пару кликов.', NULL,
       'https://swiftmatch.app/go/restoclub-first-date', 2500.00, 'Москва', 'hangout', 'active', DATE_ADD(CURDATE(), INTERVAL 1 YEAR)
FROM partners p
WHERE p.name = 'Restoclub'
  AND NOT EXISTS (SELECT 1 FROM partner_offers WHERE title = 'Ресторан для первого свидания');

-- Отель на выходные для пары (Ostrovok, commission 4%)
INSERT INTO partner_offers (partner_id, category, title, description, image_url, deeplink, price, city, placement, status, valid_to)
SELECT p.id, 'hotel', 'Отель на романтический уикенд', 'Подборка отелей для двоих: завтрак включён, поздний чекаут — идеально для вылазки на выходные.', NULL,
       'https://swiftmatch.app/go/ostrovok-weekend', 6000.00, 'Санкт-Петербург', 'hangout', 'active', DATE_ADD(CURDATE(), INTERVAL 1 YEAR)
FROM partners p
WHERE p.name = 'Ostrovok'
  AND NOT EXISTS (SELECT 1 FROM partner_offers WHERE title = 'Отель на романтический уикенд');

-- Цветы для свидания (Flowwow, commission 15%)
INSERT INTO partner_offers (partner_id, category, title, description, image_url, deeplink, price, city, placement, status, valid_to)
SELECT p.id, 'flowers', 'Цветы к свиданию', 'Доставка букетов за 2 часа: подарите цветы до прихода — начните вечер с приятного сюрприза.', NULL,
       'https://swiftmatch.app/go/flowwow-flowers', 1500.00, 'Москва', 'hangout', 'active', DATE_ADD(CURDATE(), INTERVAL 1 YEAR)
FROM partners p
WHERE p.name = 'Flowwow'
  AND NOT EXISTS (SELECT 1 FROM partner_offers WHERE title = 'Цветы к свиданию');

-- Такси на свидание (Yandex Go, commission 8%)
INSERT INTO partner_offers (partner_id, category, title, description, image_url, deeplink, price, city, placement, status, valid_to)
SELECT p.id, 'taxi', 'Такси до места встречи', 'Комфортный трансфер до свидания: скидка на первые поездки по партнёрскому промокоду.', NULL,
       'https://swiftmatch.app/go/yandexgo-ride', 400.00, 'Москва', 'hangout', 'active', DATE_ADD(CURDATE(), INTERVAL 1 YEAR)
FROM partners p
WHERE p.name = 'Yandex Go'
  AND NOT EXISTS (SELECT 1 FROM partner_offers WHERE title = 'Такси до места встречи');

-- Подарок партнёрше (Bouquet.ru, commission 12%)
INSERT INTO partner_offers (partner_id, category, title, description, image_url, deeplink, price, city, placement, status, valid_to)
SELECT p.id, 'gift', 'Подарок для второй половинки', 'Идеи подарков: от сладких боксов до сувениров — подберите сюрприз по интересам пары.', NULL,
       'https://swiftmatch.app/go/bouquet-gift', 2000.00, 'Москва', 'hangout', 'active', DATE_ADD(CURDATE(), INTERVAL 1 YEAR)
FROM partners p
WHERE p.name = 'Bouquet.ru'
  AND NOT EXISTS (SELECT 1 FROM partner_offers WHERE title = 'Подарок для второй половинки');
