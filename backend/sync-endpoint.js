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
    if (!record.uuid) {
      console.warn(`[Sync] Record without UUID in ${table}:`, record);
      results.push({ uuid: null, error: 'No UUID', success: false });
      continue;
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

  for (const field of config.fields) {
    if (field === 'uuid' || field in record) {
      let value = record[field];
      
      // Пропускаем служебные поля
      if (field.startsWith('_') || field.endsWith('_uuid')) {
        continue;
      }
      
      // Разрешаем ссылки на другие таблицы
      if (config.resolveRefs[field]) {
        const refConfig = config.resolveRefs[field];
        const refUuid = record[field];
        if (refUuid) {
          // Ищем ID по UUID
          const refResult = await client.query(
            `SELECT ${refConfig.field} FROM ${refConfig.table} WHERE uuid = $1`,
            [refUuid]
          );
          value = refResult.rows.length > 0 ? refResult.rows[0][refConfig.field] : null;
        } else {
          value = null;
        }
      }
      
      fields.push(field);
      values.push(value);
    }
  }

  // Добавляем created_by / updated_by если есть
  if (config.tableName === 'heaters' || config.tableName === 'premises') {
    // Эти таблицы не имеют created_by
  }

  const fieldList = fields.join(', ');
  const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
  
  const sql = `
    INSERT INTO ${config.tableName} (${fieldList}, synced_at)
    VALUES (${placeholders}, CURRENT_TIMESTAMP)
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

  for (const field of config.fields) {
    if (field === 'uuid' || field in record) {
      let value = record[field];
      
      // Пропускаем служебные поля
      if (field.startsWith('_') || field.endsWith('_uuid')) {
        continue;
      }
      
      // Разрешаем ссылки на другие таблицы
      if (config.resolveRefs[field]) {
        const refConfig = config.resolveRefs[field];
        const refUuid = record[field];
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
  const tables = ['objects', 'premises', 'heaters', 'users', 'stickers', 'heater_events'];
  
  for (const table of tables) {
    let sql;
    const params = [];
    
    if (lastSyncTime) {
      sql = `SELECT * FROM ${table} WHERE created_at > $1 OR synced_at > $1`;
      params.push(lastSyncTime);
    } else {
      // Первая синхронизация - возвращаем последние 1000 записей
      sql = `SELECT * FROM ${table} ORDER BY created_at DESC LIMIT 1000`;
    }
    
    try {
      const res = await client.query(sql, params);
      result[table] = res.rows;
    } catch (err) {
      console.error(`[Sync] Error fetching ${table}:`, err.message);
      result[table] = [];
    }
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
