// sync-endpoint.js - Упрощённая синхронизация на основе UUID
// INSERT ... ON CONFLICT (uuid) DO UPDATE

const { query, getClient } = require('./db');
const crypto = require('crypto');

// Генерация детерминированного UUID на основе timestamp
// Такая же функция как на фронтенде для совместимости
function generateUUIDSync(timestamp = Date.now()) {
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
}

// Обработка синхронизации для одной таблицы
async function syncTable(client, userId, table, records, idMapping) {
  const results = [];
  const config = getTableConfig(table);
  
  if (!config) {
    console.log(`[Sync] Unknown table: ${table}`);
    return results;
  }

  for (const record of records) {
    // Если UUID нет - генерируем детерминированный на основе timestamp
    if (!record.uuid) {
      const timestamp = new Date(record.created_at).getTime() || Date.now();
      record.uuid = generateUUIDSync(timestamp);
      console.log(`[Sync] Generated UUID ${record.uuid} for ${table} without uuid`);
    }

    try {
      // Проверяем, есть ли запись с таким UUID
      const existing = await client.query(
        `SELECT id FROM ${config.tableName} WHERE uuid = $1`,
        [record.uuid]
      );

      if (existing.rows.length > 0) {
        // Обновляем существующую запись
        const serverId = existing.rows[0].id;
        await updateRecord(client, config, serverId, record, userId);
        results.push({ uuid: record.uuid, id: serverId, action: 'updated', success: true });
        console.log(`[Sync] Updated ${table}:${record.uuid} (id=${serverId})`);
      } else {
        // Создаём новую запись
        const result = await createRecord(client, config, record, userId);
        const serverId = result.id;
        
        // Сохраняем маппинг UUID → server ID
        if (!idMapping[table]) idMapping[table] = {};
        idMapping[table][record.uuid] = serverId;
        
        results.push({ uuid: record.uuid, id: serverId, action: 'created', success: true });
        console.log(`[Sync] Created ${table}:${record.uuid} (id=${serverId})`);
      }
    } catch (err) {
      console.error(`[Sync] Error syncing ${table}:${record.uuid}:`, err.message);
      results.push({ uuid: record.uuid, error: err.message, success: false });
    }
  }

  return results;
}

// Конфигурация таблиц
function getTableConfig(table) {
  const configs = {
    heaters: {
      tableName: 'heaters',
      uuidField: 'uuid',
      fields: [
        'uuid', 'premise_id', 'serial', 'name', 'power_kw', 'power_w', 'elements',
        'heating_element', 'manufacture_date', 'decommission_date', 'inventory_number',
        'voltage_v', 'protection_type', 'installation_location', 'status', 'premise_uuid'
      ],
      resolveRefs: {
        premise_uuid: { table: 'premises', field: 'premise_id' }
      }
    },
    premises: {
      tableName: 'premises',
      uuidField: 'uuid',
      fields: [
        'uuid', 'object_id', 'name', 'number', 'type', 'note', 'object_uuid'
      ],
      resolveRefs: {
        object_uuid: { table: 'objects', field: 'object_id' }
      }
    },
    objects: {
      tableName: 'objects',
      uuidField: 'uuid',
      fields: ['uuid', 'name', 'code'],
      resolveRefs: {}
    },
    users: {
      tableName: 'users',
      uuidField: 'uuid',
      fields: ['uuid', 'login', 'password_hash', 'role'],
      resolveRefs: {}
    },
    stickers: {
      tableName: 'stickers',
      uuidField: 'uuid',
      fields: [
        'uuid', 'heater_id', 'number', 'check_date', 'electrician_id',
        'heater_uuid', 'electrician_uuid'
      ],
      resolveRefs: {
        heater_uuid: { table: 'heaters', field: 'heater_id' },
        electrician_uuid: { table: 'users', field: 'electrician_id' }
      }
    },
    events: {
      tableName: 'heater_events',
      uuidField: 'uuid',
      fields: [
        'uuid', 'heater_id', 'user_id', 'event_type', 'from_premise_id',
        'to_premise_id', 'old_status', 'new_status', 'comment',
        'heater_uuid', 'user_uuid', 'from_premise_uuid', 'to_premise_uuid'
      ],
      resolveRefs: {
        heater_uuid: { table: 'heaters', field: 'heater_id' },
        user_uuid: { table: 'users', field: 'user_id' },
        from_premise_uuid: { table: 'premises', field: 'from_premise_id' },
        to_premise_uuid: { table: 'premises', field: 'to_premise_id' }
      }
    }
  };
  return configs[table];
}

// Создание записи
async function createRecord(client, config, record, userId) {
  const fields = [];
  const values = [];
  let paramIndex = 1;

  // Поля которые есть в PostgreSQL (без служебных полей фронтенда)
  const dbFields = {
    heaters: ['uuid', 'premise_id', 'serial', 'name', 'power_kw', 'power_w', 'voltage_v', 'heating_element', 'protection_type', 'manufacture_date', 'decommission_date', 'inventory_number', 'installation_location', 'photo_url', 'status'],
    premises: ['uuid', 'object_id', 'name', 'number', 'type', 'note'],
    objects: ['uuid', 'name', 'code'],
    users: ['uuid', 'login', 'password_hash', 'role'],
    stickers: ['uuid', 'heater_id', 'number', 'check_date', 'electrician_id'],
    heater_events: ['uuid', 'heater_id', 'user_id', 'event_type', 'from_premise_id', 'to_premise_id', 'old_status', 'new_status', 'comment']
  };

  const validFields = dbFields[config.tableName] || config.fields.filter(f => !f.startsWith('_') && !f.endsWith('_uuid'));

  for (const field of validFields) {
    let value = record[field];

    // Разрешаем ссылки на другие таблицы по UUID
    const uuidField = field.replace('_id', '_uuid');
    if (config.resolveRefs[uuidField]) {
      const refConfig = config.resolveRefs[uuidField];
      const refUuid = record[uuidField];
      if (refUuid) {
        // Ищем ID по UUID
        const refResult = await client.query(
          `SELECT ${refConfig.field} FROM ${refConfig.table} WHERE uuid = $1`,
          [refUuid]
        );
        value = refResult.rows.length > 0 ? refResult.rows[0][refConfig.field] : null;
      }
    }

    fields.push(field);
    values.push(value);
  }

  // Добавляем created_by / updated_by если есть
  if (config.tableName === 'heaters' || config.tableName === 'premises') {
    // Эти таблицы не имеют created_by
  }

  const fieldList = fields.join(', ');
  const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');

  // INSERT ... ON CONFLICT (uuid) DO UPDATE
  const updateFields = fields.filter(f => f !== 'uuid').map(f => `${f} = EXCLUDED.${f}`).join(', ');
  
  const sql = `
    INSERT INTO ${config.tableName} (${fieldList}, synced_at)
    VALUES (${placeholders}, CURRENT_TIMESTAMP)
    ON CONFLICT (uuid) DO UPDATE SET ${updateFields}, synced_at = CURRENT_TIMESTAMP
    RETURNING id
  `;

  const result = await client.query(sql, values);
  return { id: result.rows[0].id };
}

// Обновление записи
async function updateRecord(client, config, serverId, record, userId) {
  const updates = [];
  const values = [];
  let paramIndex = 1;

  // Поля которые есть в PostgreSQL (без служебных полей фронтенда)
  const dbFields = {
    heaters: ['premise_id', 'serial', 'name', 'power_kw', 'power_w', 'voltage_v', 'heating_element', 'protection_type', 'manufacture_date', 'decommission_date', 'inventory_number', 'installation_location', 'photo_url', 'status'],
    premises: ['object_id', 'name', 'number', 'type', 'note'],
    objects: ['name', 'code'],
    users: ['login', 'password_hash', 'role'],
    stickers: ['heater_id', 'number', 'check_date', 'electrician_id'],
    heater_events: ['heater_id', 'user_id', 'event_type', 'from_premise_id', 'to_premise_id', 'old_status', 'new_status', 'comment']
  };

  const validFields = dbFields[config.tableName] || config.fields.filter(f => !f.startsWith('_') && !f.endsWith('_uuid'));

  for (const field of validFields) {
    if (field in record) {
      let value = record[field];

      // Разрешаем ссылки на другие таблицы по UUID
      const uuidField = field.replace('_id', '_uuid');
      if (config.resolveRefs[uuidField]) {
        const refConfig = config.resolveRefs[uuidField];
        const refUuid = record[uuidField];
        if (refUuid) {
          const refResult = await client.query(
            `SELECT ${refConfig.field} FROM ${refConfig.table} WHERE uuid = $1`,
            [refUuid]
          );
          value = refResult.rows.length > 0 ? refResult.rows[0][refConfig.field] : null;
        } else {
          value = null;
        }
      }

      updates.push(`${field} = $${paramIndex++}`);
      values.push(value);
    }
  }

  if (updates.length === 0) {
    return;
  }

  updates.push(`synced_at = CURRENT_TIMESTAMP`);
  values.push(serverId);
  
  const sql = `
    UPDATE ${config.tableName}
    SET ${updates.join(', ')}
    WHERE id = $${paramIndex}
  `;

  await client.query(sql, values);
}

// Получение обновлений с сервера
async function getServerUpdates(client, lastSyncTime) {
  const result = {};
  const params = [];

  if (lastSyncTime) {
    params.push(lastSyncTime);
  }

  // Возвращаем обогреватели с sticker_number через JOIN
  try {
    const sql = `
      SELECT h.*, s.number as sticker_number
      FROM heaters h
      LEFT JOIN stickers s ON h.id = s.heater_id
      WHERE ${lastSyncTime ? '(h.created_at > $1 OR h.synced_at > $1)' : 'TRUE'}
      ORDER BY h.created_at DESC
      ${lastSyncTime ? '' : 'LIMIT 1000'}
    `;
    const res = await client.query(sql, lastSyncTime ? params : []);
    result.heaters = res.rows;
  } catch (err) {
    console.error(`[Sync] Error fetching heaters:`, err.message);
    result.heaters = [];
  }

  // Возвращаем помещения
  try {
    const sql = `SELECT * FROM premises WHERE ${lastSyncTime ? '(created_at > $1 OR synced_at > $1)' : 'TRUE'} ORDER BY created_at DESC ${lastSyncTime ? '' : 'LIMIT 1000'}`;
    const res = await client.query(sql, lastSyncTime ? params : []);
    result.premises = res.rows;
  } catch (err) {
    console.error(`[Sync] Error fetching premises:`, err.message);
    result.premises = [];
  }

  // Возвращаем объекты
  try {
    const sql = `SELECT * FROM objects WHERE ${lastSyncTime ? '(created_at > $1 OR synced_at > $1)' : 'TRUE'} ORDER BY created_at DESC ${lastSyncTime ? '' : 'LIMIT 1000'}`;
    const res = await client.query(sql, lastSyncTime ? params : []);
    result.objects = res.rows;
  } catch (err) {
    console.error(`[Sync] Error fetching objects:`, err.message);
    result.objects = [];
  }

  // Возвращаем пользователей
  try {
    const sql = `SELECT * FROM users WHERE ${lastSyncTime ? '(created_at > $1 OR synced_at > $1)' : 'TRUE'} ORDER BY created_at DESC ${lastSyncTime ? '' : 'LIMIT 1000'}`;
    const res = await client.query(sql, lastSyncTime ? params : []);
    result.users = res.rows;
  } catch (err) {
    console.error(`[Sync] Error fetching users:`, err.message);
    result.users = [];
  }

  // Возвращаем stickers
  try {
    const sql = `SELECT * FROM stickers WHERE ${lastSyncTime ? '(created_at > $1 OR synced_at > $1)' : 'TRUE'} ORDER BY created_at DESC ${lastSyncTime ? '' : 'LIMIT 1000'}`;
    const res = await client.query(sql, lastSyncTime ? params : []);
    result.stickers = res.rows;
  } catch (err) {
    console.error(`[Sync] Error fetching stickers:`, err.message);
    result.stickers = [];
  }

  // Возвращаем события
  try {
    const sql = `SELECT * FROM heater_events WHERE ${lastSyncTime ? '(created_at > $1 OR synced_at > $1)' : 'TRUE'} ORDER BY created_at DESC ${lastSyncTime ? '' : 'LIMIT 1000'}`;
    const res = await client.query(sql, lastSyncTime ? params : []);
    result.heater_events = res.rows;
  } catch (err) {
    console.error(`[Sync] Error fetching heater_events:`, err.message);
    result.heater_events = [];
  }

  return result;
}

// Основной endpoint
async function setupSyncEndpoint(router) {
  const { authMiddleware } = require('./auth');
  
  router.post('/sync', authMiddleware(), async (req, res) => {
    const client = await getClient();
    
    try {
      await client.query('BEGIN');

      const payload = req.body;
      const idMapping = {};
      const syncResults = {};

      console.log('[Sync] Received payload:', Object.keys(payload));

      // 1. Сначала обрабатываем объекты (нет зависимостей)
      if (payload.objects) {
        syncResults.objects = await syncTable(client, req.user.id, 'objects', payload.objects, idMapping);
      }

      // 2. Затем помещения (зависят от объектов)
      if (payload.premises) {
        syncResults.premises = await syncTable(client, req.user.id, 'premises', payload.premises, idMapping);
      }

      // 3. Потом обогреватели (зависят от помещений)
      if (payload.heaters) {
        syncResults.heaters = await syncTable(client, req.user.id, 'heaters', payload.heaters, idMapping);
      }

      // 4. Остальные таблицы
      for (const table of ['users', 'stickers', 'events']) {
        if (payload[table]) {
          syncResults[table] = await syncTable(client, req.user.id, table, payload[table], idMapping);
        }
      }

      // 5. Получаем обновления с сервера
      const serverUpdates = await getServerUpdates(client, payload.lastSyncTime);

      // Логируем в sync_log
      await client.query(
        `INSERT INTO sync_log (user_id, action, payload, synced, response) 
         VALUES ($1, $2, $3, true, $4)`,
        [req.user.id, 'sync', JSON.stringify(payload), JSON.stringify({ 
          syncResults, 
          serverUpdates,
          timestamp: new Date().toISOString()
        })]
      );

      await client.query('COMMIT');

      const successCount = Object.values(syncResults).flat().filter(r => r.success).length;
      console.log(`[Sync] Completed: ${successCount} records synced`);

      res.json({
        success: true,
        synced: successCount,
        syncResults,
        data: serverUpdates
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[Sync] Error:', err);
      res.status(500).json({ 
        error: 'Internal server error',
        details: err.message 
      });
    } finally {
      client.release();
    }
  });
}

module.exports = { setupSyncEndpoint, syncTable, getServerUpdates };
