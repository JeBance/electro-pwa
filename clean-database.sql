-- Скрипт для очистки базы данных PostgreSQL
-- Выполнить: psql -U postgres -d electro -f clean-database.sql

-- ===== Очистка таблиц (полное удаление всех данных) =====

-- Очищаем heater_events (история)
TRUNCATE TABLE heater_events RESTART IDENTITY CASCADE;

-- Очищаем stickers (наклейки)
TRUNCATE TABLE stickers RESTART IDENTITY CASCADE;

-- Очищаем heaters (обогреватели)
TRUNCATE TABLE heaters RESTART IDENTITY CASCADE;

-- Очищаем premises (помещения)
TRUNCATE TABLE premises RESTART IDENTITY CASCADE;

-- Очищаем objects (объекты)
TRUNCATE TABLE objects RESTART IDENTITY CASCADE;

-- Очищаем user_objects (права доступа)
TRUNCATE TABLE user_objects RESTART IDENTITY CASCADE;

-- Очищаем users (пользователи, кроме admin)
DELETE FROM users WHERE login != 'admin';

-- Сбрасываем последовательности (опционально)
-- DELETE FROM users WHERE login != 'admin';

-- ===== Проверка очистки =====
SELECT 'heaters' as table_name, COUNT(*) as count FROM heaters
UNION ALL
SELECT 'premises', COUNT(*) FROM premises
UNION ALL
SELECT 'objects', COUNT(*) FROM objects
UNION ALL
SELECT 'stickers', COUNT(*) FROM stickers
UNION ALL
SELECT 'heater_events', COUNT(*) FROM heater_events
UNION ALL
SELECT 'user_objects', COUNT(*) FROM user_objects
UNION ALL
SELECT 'users', COUNT(*) FROM users;
