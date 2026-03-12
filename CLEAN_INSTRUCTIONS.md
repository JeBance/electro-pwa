# Очистка данных ELECTRO PWA

## ✅ Бэкенд очищен

База данных PostgreSQL полностью очищена:
- ✅ objects: 0 записей
- ✅ premises: 0 записей
- ✅ heaters: 0 записей
- ✅ stickers: 0 записей
- ✅ heater_events: 0 записей
- ✅ users: 1 (admin)

## 🔄 Очистка фронтенда

### Способ 1: Через консоль браузера (рекомендуется)

1. Откройте приложение в браузере
2. Нажмите **F12** (открыть консоль разработчика)
3. Вставьте и выполните:

```javascript
await cleanAllFrontendData()
```

4. Подтвердите очистку
5. Перезагрузите страницу: **Ctrl + Shift + R** (или **Cmd + Shift + R** на Mac)

### Способ 2: Вручную через консоль

```javascript
// Очистка IndexedDB
await Store.db.heaters.clear();
await Store.db.premises.clear();
await Store.db.objects.clear();
await Store.db.stickers.clear();
await Store.db.events.clear();
await Store.db.users.clear();
await Store.db.userObjects.clear();
await Store.db.syncState.clear();

// Очистка кэша
const cacheNames = await caches.keys();
for (const name of cacheNames) await caches.delete(name);

// Перезагрузка данных
await loadLocalData();
render();

console.log('✅ Очистка завершена!');
```

### Способ 3: Через интерфейс (Профиль)

1. Откройте **Профиль** (нижнее меню)
2. Прокрутите вниз до раздела "Журнал операций"
3. В консоли выполните: `await cleanAllFrontendData()`

---

## 📝 После очистки

1. **Перезагрузите страницу** с очисткой кэша:
   - **Windows/Linux:** `Ctrl + Shift + R`
   - **macOS:** `Cmd + Shift + R`

2. **Войдите в систему:**
   - Логин: `admin`
   - Пароль: `admin123`

3. **Начните заполнение данных:**
   - Создайте объекты (предприятия)
   - Создайте помещения (вагоны)
   - Создайте обогреватели

---

## 🧪 Проверка синхронизации

1. Создайте объект → помещение → обогреватель **оффлайн** (отключите интернет)
2. Проверьте индикатор ⏳ у обогревателя
3. **Включите интернет**
4. Нажмите **"🔄 Синхронизировать"** в Профиле
5. Индикатор должен исчезнуть
6. Проверьте данные на другом устройстве

---

## 📄 Файлы для очистки

- `/root/git/electro-pwa/clean-data.js` — скрипт для консоли
- Функция `cleanAllFrontendData()` экспортирована в `window`
