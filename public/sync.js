// sync.js - Упрощённая синхронизация на основе UUID
// Отправляет все pending/modified записи и получает обновления с сервера

const SyncManager = {
  isSyncing: false,

  // Основная функция синхронизации
  async sync() {
    if (this.isSyncing) {
      console.log('[Sync] Already syncing, skipping...');
      return { skipped: true, reason: 'already-syncing' };
    }

    if (!navigator.onLine) {
      const msg = 'Офлайн — синхронизация невозможна';
      console.log('[Sync]', msg);
      if (window.AppLogs) AppLogs.info(msg);
      return { skipped: true, reason: 'offline' };
    }

    const token = localStorage.getItem('token');
    if (!token) {
      const msg = 'Нет токена авторизации';
      console.log('[Sync]', msg);
      if (window.AppLogs) AppLogs.error(msg);
      return { skipped: true, reason: 'no-token' };
    }

    this.isSyncing = true;

    try {
      // Получаем все записи, ожидающие синхронизации
      const payload = await Store.getSyncPayload();
      
      if (Object.keys(payload).length === 0 || (Object.keys(payload).length === 1 && payload.lastSyncTime)) {
        console.log('[Sync] Нет изменений для отправки');
        // Всё равно загружаем обновления с сервера
        payload.empty = true;
      }

      const msg = `Синхронизация... (${Object.keys(payload).filter(k => k !== 'lastSyncTime' && k !== 'empty').length} таблиц)`;
      console.log('[Sync]', msg);
      if (window.AppLogs) AppLogs.info(msg);

      // Отправляем на сервер
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const result = await response.json();
      console.log('[Sync] Server response:', result);

      // Применяем ответ сервера к локальным данным
      if (result.data) {
        const syncedCount = await Store.applyServerResponse(result.data);
        const successMsg = `Синхронизировано: ${syncedCount} записей`;
        console.log('[Sync]', successMsg);
        if (window.AppLogs) AppLogs.success(successMsg);
      }

      // Обновляем UI
      if (typeof loadLocalData === 'function') {
        await loadLocalData();
      }
      if (typeof render === 'function') {
        render();
      }

      return { 
        success: true, 
        synced: result.synced || 0,
        serverRecords: result.data 
      };
    } catch (err) {
      const msg = `Ошибка синхронизации: ${err.message}`;
      console.error('[Sync]', msg);
      if (window.AppLogs) AppLogs.error(msg);
      
      // Помечаем все pending записи как failed
      await this.markAllFailed(err.message);
      
      return { error: err.message };
    } finally {
      this.isSyncing = false;
    }
  },

  // Пометить все pending записи как failed при ошибке
  async markAllFailed(error) {
    const tables = ['heaters', 'premises', 'objects', 'users', 'stickers', 'events'];
    for (const table of tables) {
      const pending = await Store.getPending(table);
      for (const record of pending) {
        await Store.markSyncError(table, record.uuid, error);
      }
    }
  },

  // Принудительная синхронизация (игнорируя lastSyncTime)
  async forceSync() {
    console.log('[Sync] Force sync...');
    return await this.sync();
  },

  // Авто-синхронизация при появлении интернета
  init() {
    window.addEventListener('online', () => {
      console.log('[Sync] Онлайн, запускаем синхронизацию');
      this.sync();
    });

    // Периодическая синхронизация каждые 60 секунд
    setInterval(() => {
      if (navigator.onLine && !this.isSyncing) {
        this.sync();
      }
    }, 60000);
  }
};

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SyncManager;
}
