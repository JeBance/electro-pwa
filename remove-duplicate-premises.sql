-- Скрипт для удаления дубликатов помещений
-- Оставляет только самую старую запись (с минимальным created_at или id)
-- Выполнить: psql -h localhost -U electro -d electro -f remove_duplicate_premises.sql

BEGIN;

-- Показываем дубликаты перед удалением
SELECT 'Дубликаты перед удалением:' as info;
SELECT name, COUNT(*) as count 
FROM premises 
GROUP BY name 
HAVING COUNT(*) > 1 
ORDER BY name;

-- Удаляем дубликаты, оставляя запись с минимальным id
DELETE FROM premises 
WHERE id IN (
  SELECT p1.id 
  FROM premises p1 
  INNER JOIN premises p2 ON p1.name = p2.name 
    AND p1.object_id = p2.object_id 
    AND p1.id > p2.id  -- Оставляем запись с меньшим id
);

-- Проверяем результат
SELECT 'Дубликаты после удаления:' as info;
SELECT name, COUNT(*) as count 
FROM premises 
GROUP BY name 
HAVING COUNT(*) > 1 
ORDER BY name;

-- Показываем сколько удалено
SELECT 'Удалено дубликатов:' as info, 
       (SELECT COUNT(*) FROM premises) as remaining_count;

COMMIT;
