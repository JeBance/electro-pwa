// store.js - Единый источник истины (IndexedDB)
// Новая архитектура: UUID + статусы синхронизации

const Store = {
  db: null,

  // Генерация детерминированного UUID на основе timestamp
  // Использует SHA-256 хэш от временной метки
  async generateUUID(timestamp = Date.now()) {
    // Формируем строку для хэширования
    const data = `electro-${timestamp}-${Math.random()}`;
    
    // Создаем хэш с помощью Web Crypto API
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    // Формируем UUID v4 из хэша (32 символа -> 8-4-4-4-12)
    const uuid = [
      hashHex.slice(0, 8),
      hashHex.slice(8, 12),
      '4' + hashHex.slice(13, 16), // Версия 4
      (parseInt(hashHex.slice(16, 18), 16) & 0x3 | 0x8).toString(16) + hashHex.slice(18, 20),
      hashHex.slice(20, 32)
    ].join('-');
    
    return uuid;
  },

  // Генерация UUID из timestamp (синхронная версия для оффлайн)
  generateUUIDSync(timestamp = Date.now()) {
    // Простая детерминированная генерация на основе timestamp
    // Формат: timestamp (13 цифр) + случайные биты для уникальности
    const timeHex = timestamp.toString(16).padStart(16, '0');
    const random1 = Math.floor(Math.random() * 0xFFFF).toString(16).padStart(4, '0');
    const random2 = Math.floor(Math.random() * 0xFFFF).toString(16).padStart(4, '0');
    const random3 = Math.floor(Math.random() * 0xFFFF).toString(16).padStart(4, '0');
    const random4 = Math.floor(Math.random() * 0xFFFFFFFFFFFF).toString(16).padStart(12, '0');
    
    // Формируем UUID с версией 4
    const uuid = `${timeHex.slice(0, 8)}-${timeHex.slice(8, 12)}-4${timeHex.slice(12, 15)}-${random1}-${random2}${random3}${random4}`;
    
    return uuid;
  },

  // Инициализация Dexie
  init() {
    this.db = new Dexie('ElectroDB');
    this.db.version(1).stores({
      heaters: 'uuid, id, premise_uuid, status, name, serial, deleted_at, _sync_status, _modified',
      premises: 'uuid, id, object_uuid, name, type, note, deleted_at, _sync_status, _modified',
      objects: 'uuid, id, name, code, deleted_at, _sync_status, _modified',
      users: 'uuid, id, login, role, deleted_at, _sync_status, _modified',
      stickers: 'uuid, id, heater_uuid, number, check_date, electrician_uuid, _sync_status, _modified',
      events: 'uuid, id, heater_uuid, event_type, created_at, _sync_status, _modified',
      userObjects: '++id, user_uuid, object_uuid',
      syncState: 'key' // Для хранения lastSyncTime
    });
    return this.db;
  },

  // ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====
  
  // Подготовка записи для сохранения
  async prepareRecord(data, isUpdate = false) {
    const record = { ...data };
    const timestamp = Date.now();
    
    // Генерируем UUID если нет (детерминированный на основе timestamp)
    if (!record.uuid) {
      // Используем синхронную версию для простоты
      record.uuid = this.generateUUIDSync(timestamp);
    }
    
    // Устанавливаем флаги синхронизации
    if (!isUpdate) {
      record._sync_status = 'pending'; // Новая запись ожидает синхронизации
      record._modified = true;
      record.created_at = new Date(timestamp).toISOString();
    } else {
      record._sync_status = record._sync_status || 'pending';
      record._modified = true; // Любое изменение помечается
      record.updated_at = new Date(timestamp).toISOString();
    }
    
    return record;
  },

  // ===== ЧТЕНИЕ (всегда из IndexedDB) =====
  async getAll(table) {
    if (!this.db) throw new Error('Store not initialized');
    return await this.db[table].toArray();
  },

  async get(table, uuid) {
    if (!this.db) throw new Error('Store not initialized');
    return await this.db[table].get(uuid);
  },

  async getByField(table, field, value) {
    if (!this.db) throw new Error('Store not initialized');
    return await this.db[table].where(field).equals(value).toArray();
  },

  // Получить записи, ожидающие синхронизации
  async getPending(table) {
    if (!this.db) throw new Error('Store not initialized');
    return await this.db[table].filter(r => r._sync_status === 'pending' || r._modified === true).toArray();
  },

  // Получить все записи с статусом
  async getBySyncStatus(table, status) {
    if (!this.db) throw new Error('Store not initialized');
    return await this.db[table].filter(r => r._sync_status === status).toArray();
  },

  // ===== ЗАПИСЬ (в IndexedDB) =====
  
  async create(table, data) {
    if (!this.db) throw new Error('Store not initialized');

    const record = await this.prepareRecord(data, false);
    const uuid = record.uuid;
    
    await this.db[table].add(record);
    
    console.log(`[Store] Created ${table}:${uuid}`, record);
    return { uuid, ...record };
  },

  async update(table, uuid, data) {
    if (!this.db) throw new Error('Store not initialized');

    const existing = await this.db[table].get(uuid);
    if (!existing) {
      throw new Error(`Record ${uuid} not found`);
    }

    const record = await this.prepareRecord({ ...existing, ...data }, true);
    await this.db[table].update(uuid, record);
    
    console.log(`[Store] Updated ${table}:${uuid}`, record);
    return { uuid, ...record };
  },

  async delete(table, uuid, softDeleteField = 'deleted_at') {
    if (!this.db) throw new Error('Store not initialized');

    const existing = await this.db[table].get(uuid);
    if (!existing) {
      throw new Error(`Record ${uuid} not found`);
    }

    if (softDeleteField && existing[softDeleteField] !== undefined) {
      // Soft delete - помечаем как удалённую и на синхронизацию
      await this.db[table].update(uuid, {
        [softDeleteField]: new Date().toISOString(),
        _modified: true,
        _sync_status: 'pending'
      });
    } else {
      // Hard delete
      await this.db[table].delete(uuid);
    }
    
    console.log(`[Store] Deleted ${table}:${uuid}`);
    return uuid;
  },

  // ===== СИНХРОНИЗАЦИЯ =====
  
  // Пометить запись как синхронизированную
  async markSynced(table, uuid, serverData = null) {
    if (!this.db) throw new Error('Store not initialized');
    
    const updateData = {
      _sync_status: 'synced',
      _modified: false,
      synced_at: new Date().toISOString()
    };
    
    // Если есть данные с сервера - обновляем
    if (serverData) {
      // Сохраняем только поля, которые могут прийти с сервера
      Object.assign(updateData, serverData);
    }
    
    await this.db[table].update(uuid, updateData);
    console.log(`[Store] Marked synced ${table}:${uuid}`);
  },

  // Пометить запись как ошибку синхронизации
  async markSyncError(table, uuid, error) {
    if (!this.db) throw new Error('Store not initialized');
    
    await this.db[table].update(uuid, {
      _sync_status: 'failed',
      _modified: true, // Оставляем modified для повторной попытки
      _sync_error: error,
      _sync_error_at: new Date().toISOString()
    });
    console.log(`[Store] Sync error ${table}:${uuid} - ${error}`);
  },

  // Получить время последней синхронизации
  async getLastSyncTime() {
    const state = await this.db.syncState.get('lastSyncTime');
    return state?.value || null;
  },

  // Установить время последней синхронизации
  async setLastSyncTime(time = new Date().toISOString()) {
    await this.db.syncState.put({ key: 'lastSyncTime', value: time });
    console.log(`[Store] Last sync time: ${time}`);
  },

  // ===== ЗАГРУЗКА С СЕРВЕРА (бэкенд → фронтенд) =====
  
  async syncFromServer(table, serverData) {
    if (!this.db) throw new Error('Store not initialized');
    
    const localRecords = await this.db[table].toArray();
    const updates = [];
    
    for (const serverRecord of serverData) {
      if (!serverRecord.uuid) {
        console.warn(`[Store] Server record without UUID:`, serverRecord);
        continue;
      }
      
      const local = localRecords.find(r => r.uuid === serverRecord.uuid);
      
      if (local && local._modified && local._sync_status === 'pending') {
        // Локальная запись ещё не синхронизирована - пропускаем
        // Сервер должен был принять её при синхронизации
        continue;
      }
      
      if (local && !local._modified && local._sync_status === 'synced') {
        // Локальная запись уже синхронизирована и не изменена
        // Проверяем, новее ли версия с сервера
        const serverTime = new Date(serverRecord.updated_at || serverRecord.created_at);
        const localTime = new Date(local.synced_at || local.created_at);
        if (serverTime <= localTime) {
          continue; // Серверная версия не новее
        }
      }
      
      // Добавляем запись для обновления/создания
      updates.push({
        ...serverRecord,
        _sync_status: 'synced',
        _modified: false,
        synced_at: new Date().toISOString()
      });
    }
    
    if (updates.length > 0) {
      await this.db[table].bulkPut(updates);
      console.log(`[Store] Synced ${updates.length} records from server for ${table}`);
    }
    
    return updates.length;
  },

  // ===== МАССИВЫ ДЛЯ UI (кэш в памяти) =====
  async refreshHeaters() {
    const items = await this.getAll('heaters');
    const premises = await this.getAll('premises');
    
    // Создаём мапу UUID -> premise и ID -> premise
    const premiseUuidMap = new Map();
    const premiseIdMap = new Map();
    premises.forEach(p => {
      premiseUuidMap.set(p.uuid, p);
      premiseIdMap.set(p.id, p);
    });
    
    // Обновляем обогреватели: добавляем premise_id и premise_name
    window.heaters = items.filter(h => !h.deleted_at).map(h => {
      // Сначала пробуем найти по UUID
      let premise = premiseUuidMap.get(h.premise_uuid);
      // Если не нашли, пробуем по ID (для оффлайн-помещений)
      if (!premise && h.premise_id) {
        premise = premiseIdMap.get(h.premise_id);
      }
      return {
        ...h,
        premise_id: premise?.id || h.premise_id,
        premise_name: premise?.name || h.premise_name
      };
    });
    
    return window.heaters;
  },

  async refreshPremises() {
    const items = await this.getAll('premises');
    const objects = await this.getAll('objects');
    
    // Создаём мапу UUID -> object и ID -> object
    const objectUuidMap = new Map();
    const objectIdMap = new Map();
    objects.forEach(o => {
      objectUuidMap.set(o.uuid, o);
      objectIdMap.set(o.id, o);
    });
    
    // Обновляем помещения: добавляем object_id и object_name
    window.premises = items.filter(p => !p.deleted_at).map(p => {
      // Сначала пробуем найти по UUID
      let obj = objectUuidMap.get(p.object_uuid);
      // Если не нашли, пробуем по ID (для оффлайн-объектов)
      if (!obj && p.object_id) {
        obj = objectIdMap.get(p.object_id);
      }
      return {
        ...p,
        object_id: obj?.id || p.object_id,
        object_name: obj?.name || p.object_name
      };
    });
    
    return window.premises;
  },

  async refreshObjects() {
    const items = await this.getAll('objects');
    window.objects = items.filter(o => !o.deleted_at);
    return window.objects;
  },

  async refreshUsers() {
    const items = await this.getAll('users');
    window.users = items.filter(u => !u.deleted_at);
    return window.users;
  },

  async refreshStickers() {
    const items = await this.getAll('stickers');
    window.stickers = items;
    return window.stickers;
  },

  async refreshEvents() {
    const items = await this.getAll('events');
    window.events = items;
    return window.events;
  },

  // ===== ПОЛНАЯ СИНХРОНИЗАЦИЯ =====
  
  async getSyncPayload() {
    const payload = {};
    const tables = ['heaters', 'premises', 'objects', 'users', 'stickers', 'events'];
    
    for (const table of tables) {
      const pending = await this.getPending(table);
      if (pending.length > 0) {
        payload[table] = pending;
      }
    }
    
    payload.lastSyncTime = await this.getLastSyncTime();
    return payload;
  },

  async applyServerResponse(serverData) {
    const tables = ['heaters', 'premises', 'objects', 'users', 'stickers', 'events'];
    let totalSynced = 0;
    
    for (const table of tables) {
      if (serverData[table]) {
        const count = await this.syncFromServer(table, serverData[table]);
        totalSynced += count;
      }
    }
    
    await this.setLastSyncTime();
    return totalSynced;
  }
};

// Экспорт для использования в других модулях
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Store;
}
