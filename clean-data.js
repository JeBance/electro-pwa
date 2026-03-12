// Скрипт для очистки IndexedDB и кэша приложения
// Выполнить в консоли браузера (F12)

(async function cleanAllData() {
  console.log('🧹 Начало очистки данных...');
  
  try {
    // 1. Очищаем IndexedDB
    if (window.Store && window.Store.db) {
      await window.Store.db.heaters.clear();
      console.log('✅ Обогреватели очищены');
      
      await window.Store.db.premises.clear();
      console.log('✅ Помещения очищены');
      
      await window.Store.db.objects.clear();
      console.log('✅ Объекты очищены');
      
      await window.Store.db.stickers.clear();
      console.log('✅ Наклейки очищены');
      
      await window.Store.db.events.clear();
      console.log('✅ События очищены');
      
      await window.Store.db.users.clear();
      console.log('✅ Пользователи очищены');
      
      await window.Store.db.userObjects.clear();
      console.log('✅ Права объектов очищены');
      
      await window.Store.db.syncState.clear();
      console.log('✅ Состояние синхронизации очищено');
    }
    
    // 2. Очищаем кэш Service Worker
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      for (const cacheName of cacheNames) {
        await caches.delete(cacheName);
      }
      console.log('✅ Кэши Service Worker очищены');
    }
    
    // 3. Очищаем localStorage (кроме токена)
    const token = localStorage.getItem('token');
    localStorage.clear();
    if (token) {
      localStorage.setItem('token', token);
    }
    console.log('✅ localStorage очищен (токен сохранён)');
    
    // 4. Перезагружаем данные
    if (typeof loadLocalData === 'function') {
      await loadLocalData();
      console.log('✅ Данные перезагружены');
    }
    
    // 5. Перерисовываем интерфейс
    if (typeof render === 'function') {
      render();
      console.log('✅ Интерфейс перерисован');
    }
    
    console.log('✅✅✅ Очистка завершена!');
    console.log('📝 Перезагрузите страницу (Ctrl+Shift+R) для применения изменений');
    
  } catch (err) {
    console.error('❌ Ошибка очистки:', err);
  }
})();
