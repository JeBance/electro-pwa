# Синхронизация на основе UUID

## Архитектура

Новая система синхронизации использует UUID для идентификации записей и флаги состояния для отслеживания изменений.

### Ключевые изменения

1. **UUID для всех записей** — каждая запись получает уникальный UUID при создании
2. **Флаги синхронизации** — `_sync_status` и `_modified` для отслеживания состояния
3. **Двусторонняя синхронизация** — отправка изменений и получение обновлений с сервера
4. **Нет очереди операций** — вместо очереди отправляются все изменённые записи

---

## Структура записей

### IndexedDB (фронтенд)

```javascript
{
  uuid: "a3f5b8c1-2d4e-4f6a-9b8c-1d2e3f4a5b6c",  // Уникальный ID
  id: 42,                                          // Локальный ID (если есть)
  name: "Обогреватель",
  _sync_status: "pending",  // pending | synced | failed
  _modified: true,          // true если есть локальные изменения
  _sync_error: null,        // Текст ошибки если failed
  synced_at: "2026-03-11T14:00:00Z",
  created_at: "2026-03-11T13:00:00Z"
}
```

### PostgreSQL (бэкенд)

```sql
CREATE TABLE heaters (
  id SERIAL PRIMARY KEY,
  uuid UUID DEFAULT gen_random_uuid(),
  name VARCHAR(100),
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

---

## Статусы синхронизации

| Статус | Описание | Что происходит |
|--------|----------|----------------|
| `pending` | Ожидает синхронизации | Новая запись или есть локальные изменения |
| `synced` | Синхронизирована | Запись на сервере, локальных изменений нет |
| `failed` | Ошибка синхронизации | Произошла ошибка, требуется повторная попытка |

---

## Визуальные индикаторы

В интерфейсе используются индикаторы статуса:

- ⏳ **Жёлтый** — запись ожидает синхронизации (pending)
- ❌ **Красный** — ошибка синхронизации (failed)
- (нет индикатора) — запись синхронизирована (synced)

---

## Процесс синхронизации

### 1. Фронтенд → Бэкенд

```javascript
// Получаем все изменённые записи
const payload = await Store.getSyncPayload();
// { heaters: [...], premises: [...], objects: [...], lastSyncTime: "..." }

// Отправляем на сервер
const response = await fetch('/api/sync', {
  method: 'POST',
  body: JSON.stringify(payload)
});

// Получаем обновления с сервера
const { data } = await response.json();
// data.heaters, data.premises, data.objects, ...

// Применяем к локальным данным
await Store.applyServerResponse(data);
```

### 2. Бэкенд → Фронтенд

```javascript
// Сервер получает lastSyncTime
const lastSyncTime = payload.lastSyncTime;

// Возвращает все записи, изменённые после этого времени
const updates = await query(`
  SELECT * FROM heaters 
  WHERE created_at > $1 OR synced_at > $1
`, [lastSyncTime]);
```

---

## API

### Store.js

```javascript
// Создание записи (с UUID и флагами)
await Store.create('heaters', { name: "...", object_uuid: "..." });

// Обновление записи
await Store.update('heaters', uuid, { name: "Новое имя" });

// Удаление записи
await Store.delete('heaters', uuid);

// Получить pending записи
const pending = await Store.getPending('heaters');

// Пометить как синхронизированную
await Store.markSynced('heaters', uuid, serverData);

// Пометить как ошибку
await Store.markSyncError('heaters', uuid, "Ошибка сети");

// Получить payload для отправки
const payload = await Store.getSyncPayload();

// Применить ответ сервера
await Store.applyServerResponse(serverData);
```

### SyncManager.js

```javascript
// Основная синхронизация
await SyncManager.sync();

// Принудительная синхронизация
await SyncManager.forceSync();

// Авто-синхронизация при появлении интернета
SyncManager.init();
```

---

## Примеры использования

### Создание объекта оффлайн

```javascript
// 1. Создаём объект (оффлайн)
await Store.create('objects', { name: "Тестовый объект" });
// _sync_status: 'pending', _modified: true

// 2. Проверяем статус
const pending = await Store.getPending('objects');
// [{ uuid: "...", name: "Тестовый объект", _sync_status: "pending" }]

// 3. Появился интернет — синхронизируем
await SyncManager.sync();
// Отправляет на сервер, получает server ID
// _sync_status: 'synced', _modified: false
```

### Обновление записи

```javascript
// 1. Обновляем обогреватель
await Store.update('heaters', uuid, { status: 'repair' });
// _sync_status: 'pending', _modified: true

// 2. Синхронизируем
await SyncManager.sync();
// Сервер обновляет запись
// _sync_status: 'synced', _modified: false
```

### Обработка ошибок

```javascript
// Если синхронизация не удалась
try {
  await SyncManager.sync();
} catch (err) {
  // Записи помечаются как failed
  // _sync_status: 'failed', _sync_error: "Failed to fetch"
  
  // Повторная попытка
  await SyncManager.sync();
}
```

---

## Миграция БД

Выполните миграцию для добавления UUID:

```bash
cd /root/git/electro-pwa
sudo -u postgres psql -d electro -f migration_uuid_sync.sql
```

Это добавит:
- `uuid UUID` — уникальный идентификатор
- `synced_at TIMESTAMPTZ` — время последней синхронизации
- Индексы для ускорения синхронизации

---

## Отличия от старой системы

| Старая система | Новая система |
|----------------|---------------|
| Локальные ID (`local_123`) | UUID v4 |
| Очередь операций | Флаги `_sync_status` и `_modified` |
| Сложная обработка зависимостей | Разрешение UUID на сервере |
| Только фронтенд → бэкенд | Двусторонняя синхронизация |
| Нет статуса у записей | Статус у каждой записи |

---

## Тестирование

### 1. Сброс данных

```javascript
// Профиль → "Операций в очереди" → "🗑️ Сброс данных"
// Или в консоли:
await clearQueueAndData();
```

### 2. Создание оффлайн

1. Отключите интернет
2. Создайте объект → обогреватель
3. Проверьте индикаторы ⏳
4. Включите интернет
5. Нажмите "🔄 Синхронизировать"
6. Индикаторы должны исчезнуть

### 3. Проверка логов

```javascript
// В консоли браузера:
AppLogs.getLogs();
```

---

## Решение проблем

### Запись не синхронизируется

1. Проверьте статус: `record._sync_status`
2. Если `failed` — проверьте `_sync_error`
3. Попробуйте ещё раз: `SyncManager.sync()`

### "Failed to fetch"

- Backend недоступен
- Проверьте подключение к серверу
- CORS настройки в `server.js`

### Дубликаты записей

- UUID должен быть уникальным
- Проверьте индексы в БД: `idx_heaters_uuid`
