// sync-endpoint.js - Упрощённая синхронизация на основе UUID
// INSERT ... ON CONFLICT (uuid) DO UPDATE

const { query, getClient } = require('./db');

// Обработка синхронизации для одной таблицы
async function syncTable(client, userId, table, records, idMapping) {
  const results = [];
  const config = getTableConfig(table);

  if (!config) {
    console.log(`[Sync] Unknown table: ${table}`);
    return results;
  }

  for (const record of records) {
    // Если UUID нет - генерируем
    if (!record.uuid) {
      const timestamp = new Date(record.created_at).getTime() || Date.now();
      record.uuid = generateUUIDFromTimestamp(timestamp);
      console.log(`[Sync] Generated UUID ${record.uuid} for ${table} without uuid`);
    }

    try {
      // Разрешаем ссылки через idMapping (если uuid ещё не создан на сервере)
      await resolveReferences(client, table, record, idMapping);

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

// Генерация UUID из timestamp (для совместимости с фронтендом)
function generateUUIDFromTimestamp(timestamp = Date.now()) {
  const part1 = Math.floor(Math.random() * 0xFFFFFFFF).toString(16).padStart(8, '0');
  const part2 = Math.floor(Math.random() * 0xFFFF).toString(16).padStart(4, '0');
  const part3 = Math.floor(Math.random() * 0x0FFF).toString(16).padStart(4, '0');
  const part4 = Math.floor(Math.random() * 0x3FFF + 0x8000).toString(16).padStart(4, '0');
  const part5 = Math.floor(Math.random() * 0xFFFFFFFFFFFF).toString(16).padStart(12, '0');
  return `${part1}-${part2}-4${part3.slice(1)}-${part4}-${part5}`;
}

// Разрешение ссылок на другие таблицы
async function resolveReferences(client, table, record, idMapping) {
  if (table === 'premises' && record.object_uuid) {
    // Проверяем есть ли object в idMapping
    if (idMapping.objects && idMapping.objects[record.object_uuid]) {
      record.object_id = idMapping.objects[record.object_uuid];
    } else {
      // Ищем в БД по UUID
      const refResult = await client.query(
        'SELECT id FROM objects WHERE uuid = $1',
        [record.object_uuid]
      );
      if (refResult.rows.length > 0) {
        record.object_id = refResult.rows[0].id;
      }
    }
  }

  if (table === 'heaters') {
    // Разрешаем premise_uuid
    if (record.premise_uuid) {
      if (idMapping.premises && idMapping.premises[record.premise_uuid]) {
        record.premise_id = idMapping.premises[record.premise_uuid];
      } else {
        const refResult = await client.query(
          'SELECT id FROM premises WHERE uuid = $1',
          [record.premise_uuid]
        );
        if (refResult.rows.length > 0) {
          record.premise_id = refResult.rows[0].id;
        }
      }
    }
    // Разрешаем object_uuid (если есть прямое поле object_uuid в heaters)
    if (record.object_uuid && !record.premise_uuid) {
      if (idMapping.objects && idMapping.objects[record.object_uuid]) {
        // object_id для heaters не используется напрямую
      } else {
        const refResult = await client.query(
          'SELECT id FROM objects WHERE uuid = $1',
          [record.object_uuid]
        );
        if (refResult.rows.length > 0) {
          // Можно использовать для валидации
        }
      }
    }
  }

  if (table === 'stickers') {
    // Разрешаем heater_uuid
    if (record.heater_uuid) {
      if (idMapping.heaters && idMapping.heaters[record.heater_uuid]) {
        record.heater_id = idMapping.heaters[record.heater_uuid];
      } else {
        const refResult = await client.query(
          'SELECT id FROM heaters WHERE uuid = $1',
          [record.heater_uuid]
        );
        if (refResult.rows.length > 0) {
          record.heater_id = refResult.rows[0].id;
        }
      }
    }
    // Разрешаем electrician_uuid
    if (record.electrician_uuid) {
      if (idMapping.users && idMapping.users[record.electrician_uuid]) {
        record.electrician_id = idMapping.users[record.electrician_uuid];
      } else {
        const refResult = await client.query(
          'SELECT id FROM users WHERE uuid = $1',
          [record.electrician_uuid]
        );
        if (refResult.rows.length > 0) {
          record.electrician_id = refResult.rows[0].id;
        }
      }
    }
  }

  if (table === 'events') {
    // Разрешаем heater_uuid
    if (record.heater_uuid) {
      if (idMapping.heaters && idMapping.heaters[record.heater_uuid]) {
        record.heater_id = idMapping.heaters[record.heater_uuid];
      } else {
        const refResult = await client.query(
          'SELECT id FROM heaters WHERE uuid = $1',
          [record.heater_uuid]
        );
        if (refResult.rows.length > 0) {
          record.heater_id = refResult.rows[0].id;
        }
      }
    }
    // Разрешаем user_uuid
    if (record.user_uuid) {
      if (idMapping.users && idMapping.users[record.user_uuid]) {
        record.user_id = idMapping.users[record.user_uuid];
      } else {
        const refResult = await client.query(
          'SELECT id FROM users WHERE uuid = $1',
          [record.user_uuid]
        );
        if (refResult.rows.length > 0) {
          record.user_id = refResult.rows[0].id;
        }
      }
    }
    // Разрешаем from_premise_uuid
    if (record.from_premise_uuid) {
      if (idMapping.premises && idMapping.premises[record.from_premise_uuid]) {
        record.from_premise_id = idMapping.premises[record.from_premise_uuid];
      } else {
        const refResult = await client.query(
          'SELECT id FROM premises WHERE uuid = $1',
          [record.from_premise_uuid]
        );
        if (refResult.rows.length > 0) {
          record.from_premise_id = refResult.rows[0].id;
        }
      }
    }
    // Разрешаем to_premise_uuid
    if (record.to_premise_uuid) {
      if (idMapping.premises && idMapping.premises[record.to_premise_uuid]) {
        record.to_premise_id = idMapping.premises[record.to_premise_uuid];
      } else {
        const refResult = await client.query(
          'SELECT id FROM premises WHERE uuid = $1',
          [record.to_premise_uuid]
        );
        if (refResult.rows.length > 0) {
          record.to_premise_id = refResult.rows[0].id;
        }
      }
    }
  }
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
        'voltage_v', 'protection_type', 'installation_location', 'status', 'photo_url'
      ],
      resolveRefs: {
        premise_uuid: { table: 'premises', field: 'premise_id' }
      }
    },
    premises: {
      tableName: 'premises',
      uuidField: 'uuid',
      fields: [
        'uuid', 'object_id', 'name', 'number', 'type', 'note'
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
        'uuid', 'heater_id', 'number', 'check_date', 'electrician_id'
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
        'to_premise_id', 'old_status', 'new_status', 'comment'
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
    heaters: ['uuid', 'premise_id', 'serial', 'name', 'power_kw', 'power_w', 'voltage_v', 'heating_element', 'protection_type', 'manufacture_date', 'decommission_date', 'inventory_number', 'installation_location', 'photo_url', 'status', 'deleted_at'],
    premises: ['uuid', 'object_id', 'name', 'number', 'type', 'note', 'deleted_at'],
    objects: ['uuid', 'name', 'code', 'deleted_at'],
    users: ['uuid', 'login', 'password_hash', 'role', 'deleted_at'],
    stickers: ['uuid', 'heater_id', 'number', 'check_date', 'electrician_id'],
    heater_events: ['uuid', 'heater_id', 'user_id', 'event_type', 'from_premise_id', 'to_premise_id', 'old_status', 'new_status', 'comment']
  };

  const validFields = dbFields[config.tableName] || config.fields.filter(f => !f.startsWith('_'));

  for (const field of validFields) {
    // Пропускаем служебные поля фронтенда
    if (field.startsWith('_') || field.endsWith('_uuid')) {
      continue;
    }

    let value = record[field];

    // Пропускаем поля с null значением (кроме обязательных)
    if ((value === null || value === undefined) && field !== 'premise_id') {
      continue;
    }

    fields.push(field);
    values.push(value);
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
    heaters: ['premise_id', 'serial', 'name', 'power_kw', 'power_w', 'voltage_v', 'heating_element', 'protection_type', 'manufacture_date', 'decommission_date', 'inventory_number', 'installation_location', 'photo_url', 'status', 'deleted_at'],
    premises: ['object_id', 'name', 'number', 'type', 'note', 'deleted_at'],
    objects: ['name', 'code', 'deleted_at'],
    users: ['login', 'password_hash', 'role', 'deleted_at'],
    stickers: ['heater_id', 'number', 'check_date', 'electrician_id'],
    heater_events: ['heater_id', 'user_id', 'event_type', 'from_premise_id', 'to_premise_id', 'old_status', 'new_status', 'comment']
  };

  const validFields = dbFields[config.tableName] || config.fields.filter(f => !f.startsWith('_'));

  for (const field of validFields) {
    // Пропускаем служебные поля фронтенда и UUID поля
    if (field.startsWith('_') || field.endsWith('_uuid')) {
      continue;
    }

    if (field in record) {
      let value = record[field];

      // Пропускаем null значения для обязательных полей
      if (value === null || value === undefined) {
        continue;
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
      SELECT h.*, s.number as sticker_number,
             p.uuid as premise_uuid, p.name as premise_name,
             o.uuid as object_uuid, o.name as object_name
      FROM heaters h
      LEFT JOIN premises p ON h.premise_id = p.id
      LEFT JOIN objects o ON p.object_id = o.id
      LEFT JOIN stickers s ON h.id = s.heater_id
      WHERE h.deleted_at IS NULL AND (${lastSyncTime ? '(h.created_at > $1 OR h.synced_at > $1)' : 'TRUE'})
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
    const sql = `
      SELECT * FROM premises 
      WHERE deleted_at IS NULL AND (${lastSyncTime ? '(created_at > $1 OR synced_at > $1)' : 'TRUE'}) 
      ORDER BY created_at DESC 
      ${lastSyncTime ? '' : 'LIMIT 1000'}
    `;
    const res = await client.query(sql, lastSyncTime ? params : []);
    result.premises = res.rows;
  } catch (err) {
    console.error(`[Sync] Error fetching premises:`, err.message);
    result.premises = [];
  }

  // Возвращаем объекты
  try {
    const sql = `
      SELECT * FROM objects 
      WHERE deleted_at IS NULL AND (${lastSyncTime ? '(created_at > $1 OR synced_at > $1)' : 'TRUE'}) 
      ORDER BY created_at DESC 
      ${lastSyncTime ? '' : 'LIMIT 1000'}
    `;
    const res = await client.query(sql, lastSyncTime ? params : []);
    result.objects = res.rows;
  } catch (err) {
    console.error(`[Sync] Error fetching objects:`, err.message);
    result.objects = [];
  }

  // Возвращаем пользователей
  try {
    const sql = `
      SELECT * FROM users 
      WHERE deleted_at IS NULL AND (${lastSyncTime ? '(created_at > $1 OR synced_at > $1)' : 'TRUE'}) 
      ORDER BY created_at DESC 
      ${lastSyncTime ? '' : 'LIMIT 1000'}
    `;
    const res = await client.query(sql, lastSyncTime ? params : []);
    result.users = res.rows;
  } catch (err) {
    console.error(`[Sync] Error fetching users:`, err.message);
    result.users = [];
  }

  // Возвращаем stickers
  try {
    const sql = `
      SELECT * FROM stickers 
      WHERE ${lastSyncTime ? '(created_at > $1 OR synced_at > $1)' : 'TRUE'} 
      ORDER BY created_at DESC 
      ${lastSyncTime ? '' : 'LIMIT 1000'}
    `;
    const res = await client.query(sql, lastSyncTime ? params : []);
    result.stickers = res.rows;
  } catch (err) {
    console.error(`[Sync] Error fetching stickers:`, err.message);
    result.stickers = [];
  }

  // Возвращаем события
  try {
    const sql = `
      SELECT * FROM heater_events 
      WHERE ${lastSyncTime ? '(created_at > $1 OR synced_at > $1)' : 'TRUE'} 
      ORDER BY created_at DESC 
      ${lastSyncTime ? '' : 'LIMIT 1000'}
    `;
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
