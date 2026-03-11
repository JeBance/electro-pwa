const express = require('express');
const router = express.Router();
const { query, getClient } = require('./db');
const { authMiddleware, validateUser, generateToken, createUser, getAllUsers, updateUserRole, deleteUser } = require('./auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, '../public/uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, unique + path.extname(file.originalname));
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) {
      return res.status(400).json({ error: 'Login and password required' });
    }
    
    const user = await validateUser(login, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = await generateToken(user);
    res.json({ token, user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Users (admin only)
router.get('/users', authMiddleware(['admin']), async (req, res) => {
  try {
    const users = await getAllUsers();
    res.json(users);
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/users', authMiddleware(['admin']), async (req, res) => {
  try {
    const { login, password, role } = req.body;
    if (!login || !password) {
      return res.status(400).json({ error: 'Login and password required' });
    }
    const validRoles = ['admin', 'electrician', 'commander'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const user = await createUser(login, password, role || 'commander');
    res.status(201).json(user);
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/users/:id/role', authMiddleware(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    const validRoles = ['admin', 'electrician', 'commander'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const user = await updateUserRole(id, role);
    res.json(user);
  } catch (err) {
    console.error('Update user role error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user (login, password, role)
router.put('/users/:id', authMiddleware(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { login, password, role } = req.body;
    
    const validRoles = ['admin', 'electrician', 'commander'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    
    const updates = [];
    const params = [];
    let paramIndex = 1;
    
    if (login) {
      updates.push(`login = $${paramIndex++}`);
      params.push(login);
    }
    
    if (password) {
      const passwordHash = await hashPassword(password);
      updates.push(`password_hash = $${paramIndex++}`);
      params.push(passwordHash);
    }
    
    if (role) {
      updates.push(`role = $${paramIndex++}`);
      params.push(role);
    }
    
    if (updates.length === 0) {
      return res.json({ message: 'No updates' });
    }
    
    params.push(id);
    const result = await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, login, role, created_at`,
      params
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/users/:id', authMiddleware(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    await deleteUser(id);
    res.status(204).send();
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Objects
router.get('/objects', authMiddleware(), async (req, res) => {
  try {
    const { include_deleted } = req.query;
    const user = req.user;
    
    // Admin sees all objects including deleted
    if (user.role === 'admin') {
      let sql = 'SELECT o.*, true as accessible FROM objects o WHERE 1=1';
      if (include_deleted !== 'true') {
        sql += ' AND o.deleted_at IS NULL';
      }
      sql += ' ORDER BY o.name';
      const result = await query(sql);
      return res.json(result.rows);
    }
    
    // For non-admin users: check if they have explicit permissions
    // If no permissions set, show all active objects (default behavior)
    const permsResult = await query(
      'SELECT object_id FROM user_objects WHERE user_id = $1',
      [user.id]
    );
    
    let sql;
    const params = [user.id];
    
    if (permsResult.rows.length === 0) {
      // No explicit permissions - show all active objects
      sql = `
        SELECT o.*, true as accessible
        FROM objects o
        WHERE o.deleted_at IS NULL
        ORDER BY o.name
      `;
    } else {
      // Show only assigned objects
      sql = `
        SELECT o.*, true as accessible
        FROM objects o
        INNER JOIN user_objects uo ON o.id = uo.object_id AND uo.user_id = $1
        WHERE o.deleted_at IS NULL
        ORDER BY o.name
      `;
    }
    
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get objects error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/objects', authMiddleware(['admin', 'electrician']), async (req, res) => {
  try {
    const { name, code } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name required' });
    }
    const result = await query(
      'INSERT INTO objects (name, code) VALUES ($1, $2) RETURNING *',
      [name, code || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create object error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/objects/:id', authMiddleware(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    // Soft delete - set deleted_at timestamp
    await query('UPDATE objects SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
    res.status(204).send();
  } catch (err) {
    console.error('Delete object error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update object
router.put('/objects/:id', authMiddleware(['admin', 'electrician']), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code } = req.body;
    
    const result = await query(
      'UPDATE objects SET name = $1, code = $2 WHERE id = $3 RETURNING *',
      [name, code || null, id]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update object error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Restore deleted object
router.post('/objects/:id/restore', authMiddleware(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    await query('UPDATE objects SET deleted_at = NULL WHERE id = $1', [id]);
    const result = await query('SELECT * FROM objects WHERE id = $1', [id]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Restore object error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user object permissions
router.get('/users/:id/objects', authMiddleware(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(`
      SELECT uo.object_id, o.name as object_name
      FROM user_objects uo
      LEFT JOIN objects o ON uo.object_id = o.id
      WHERE uo.user_id = $1
      ORDER BY o.name
    `, [id]);
    res.json(result.rows);
  } catch (err) {
    console.error('Get user objects error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user object permissions
router.put('/users/:id/objects', authMiddleware(['admin']), async (req, res) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { object_ids } = req.body;
    
    // Delete existing permissions
    await client.query('DELETE FROM user_objects WHERE user_id = $1', [id]);
    
    // Add new permissions
    if (object_ids && object_ids.length > 0) {
      for (const objectId of object_ids) {
        await client.query(
          'INSERT INTO user_objects (user_id, object_id) VALUES ($1, $2)',
          [id, objectId]
        );
      }
    }
    
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update user objects error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Get current user's accessible objects
router.get('/my-objects', authMiddleware(), async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await query(`
      SELECT uo.object_id, o.name as object_name
      FROM user_objects uo
      LEFT JOIN objects o ON uo.object_id = o.id
      WHERE uo.user_id = $1
      ORDER BY o.name
    `, [userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Get my objects error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Premises
router.get('/premises', authMiddleware(), async (req, res) => {
  try {
    const { object_id, include_deleted } = req.query;
    const user = req.user;
    
    let deletedFilter = 'p.deleted_at IS NULL';
    if (include_deleted === 'true') {
      deletedFilter = 'TRUE';
    }
    
    // For non-admin users, check if they have explicit object permissions
    // If no permissions set, show all active premises (default behavior)
    let objectFilter = '';
    const params = [];
    let paramIndex = 1;
    
    if (user.role !== 'admin') {
      const permsResult = await query(
        'SELECT object_id FROM user_objects WHERE user_id = $1',
        [user.id]
      );
      
      if (permsResult.rows.length > 0) {
        // User has explicit permissions - filter by assigned objects
        objectFilter = `
          AND (
            EXISTS (
              SELECT 1 FROM user_objects uo 
              WHERE uo.user_id = $${paramIndex++} AND uo.object_id = p.object_id
            )
          )
        `;
        params.push(user.id);
      }
      // If no permissions, don't add filter - show all active premises
    }
    
    let sql = `
      SELECT p.*, o.name as object_name
      FROM premises p
      LEFT JOIN objects o ON p.object_id = o.id
      WHERE ${deletedFilter} ${objectFilter}
      ORDER BY o.name, p.name
    `;
    
    if (object_id) {
      sql = `
        SELECT p.*, o.name as object_name
        FROM premises p
        LEFT JOIN objects o ON p.object_id = o.id
        WHERE p.object_id = $${paramIndex++} AND ${deletedFilter} ${objectFilter}
        ORDER BY p.name
      `;
      params.push(object_id);
    }
    
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get premises error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/premises', authMiddleware(['admin', 'electrician']), async (req, res) => {
  try {
    const { object_id, name, number, type } = req.body;
    if (!object_id || !name) {
      return res.status(400).json({ error: 'Object ID and name required' });
    }
    const result = await query(
      'INSERT INTO premises (object_id, name, number, type) VALUES ($1, $2, $3, $4) RETURNING *',
      [object_id, name, number || null, type || 'wagon']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create premise error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/premises/:id', authMiddleware(['admin']), async (req, res) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { id } = req.params;

    // Find all heaters in this premise and move them to warehouse
    const heatersResult = await client.query(
      'SELECT id FROM heaters WHERE premise_id = $1 AND deleted_at IS NULL',
      [id]
    );

    for (const heater of heatersResult.rows) {
      // Get current heater status
      const heaterStatus = await client.query('SELECT status FROM heaters WHERE id = $1', [heater.id]);
      const currentStatus = heaterStatus.rows[0].status;

      // Update heater status to warehouse
      await client.query(
        'UPDATE heaters SET premise_id = NULL, status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['warehouse', heater.id]
      );

      // Log the event
      await client.query(
        `INSERT INTO heater_events (heater_id, user_id, event_type, from_premise_id, old_status, new_status, comment)
         VALUES ($1, $2, 'premise_change', $3, $4, $5, $6)`,
        [heater.id, req.user.id, id, null, currentStatus, 'warehouse', 'Обогреватель перемещён на склад']
      );
    }

    // Soft delete the premise
    await client.query('UPDATE premises SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);

    await client.query('COMMIT');
    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Delete premise error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update premise
router.put('/premises/:id', authMiddleware(['admin', 'electrician']), async (req, res) => {
  try {
    const { id } = req.params;
    const { object_id, name, number, type } = req.body;
    
    const result = await query(
      'UPDATE premises SET object_id = $1, name = $2, number = $3, type = $4 WHERE id = $5 RETURNING *',
      [object_id, name, number || null, type || 'wagon', id]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update premise error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Restore deleted premise
router.post('/premises/:id/restore', authMiddleware(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    await query('UPDATE premises SET deleted_at = NULL WHERE id = $1', [id]);
    const result = await query('SELECT * FROM premises WHERE id = $1', [id]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Restore premise error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update premise note
router.put('/premises/:id/note', authMiddleware(['admin', 'electrician']), async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    
    const result = await query(
      'UPDATE premises SET note = $1 WHERE id = $2 RETURNING *',
      [note || null, id]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update premise note error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete premise note
router.delete('/premises/:id/note', authMiddleware(['admin', 'electrician']), async (req, res) => {
  try {
    const { id } = req.params;
    
    await query(
      'UPDATE premises SET note = NULL WHERE id = $1',
      [id]
    );
    
    res.status(204).send();
  } catch (err) {
    console.error('Delete premise note error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Heaters
router.get('/heaters', authMiddleware(), async (req, res) => {
  try {
    const { premise_id, status, search, include_deleted } = req.query;
    const user = req.user;
    let deletedFilter = 'h.deleted_at IS NULL';
    if (include_deleted === 'true') {
      deletedFilter = 'TRUE';
    }
    
    // For non-admin users, check if they have explicit object permissions
    // If no permissions set, show all active heaters (default behavior)
    let objectFilter = '';
    const params = [];
    let paramIndex = 1;
    
    if (user.role !== 'admin') {
      const permsResult = await query(
        'SELECT object_id FROM user_objects WHERE user_id = $1',
        [user.id]
      );
      
      if (permsResult.rows.length > 0) {
        // User has explicit permissions - filter by assigned objects
        objectFilter = `
          AND (
            EXISTS (
              SELECT 1 FROM user_objects uo 
              WHERE uo.user_id = $${paramIndex++} AND uo.object_id = o.id
            )
          )
        `;
        params.push(user.id);
      }
      // If no permissions, don't add filter - show all active heaters
    }
    
    let sql = `
      SELECT h.*, p.name as premise_name, p.number as premise_number,
             o.name as object_name, o.id as object_id,
             s.number as sticker_number,
             (SELECT MAX(e.created_at) FROM heater_events e WHERE e.heater_id = h.id) as last_modified
      FROM heaters h
      LEFT JOIN premises p ON h.premise_id = p.id
      LEFT JOIN objects o ON p.object_id = o.id
      LEFT JOIN stickers s ON h.id = s.heater_id
      WHERE ${deletedFilter} ${objectFilter}
    `;

    if (premise_id) {
      sql += ` AND h.premise_id = $${paramIndex}`;
      params.push(premise_id);
      paramIndex++;
    }
    if (status) {
      sql += ` AND h.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    if (search) {
      sql += ` AND (h.name ILIKE $${paramIndex} OR h.serial ILIKE $${paramIndex} OR s.number ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    sql += ' ORDER BY o.name, p.name, h.name';

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get heaters error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/heaters/:id', authMiddleware(), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(`
      SELECT h.*, p.name as premise_name, p.number as premise_number,
             o.name as object_name, o.id as object_id,
             s.number as sticker_number
      FROM heaters h
      LEFT JOIN premises p ON h.premise_id = p.id
      LEFT JOIN objects o ON p.object_id = o.id
      LEFT JOIN stickers s ON h.id = s.heater_id
      WHERE h.id = $1
    `, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Heater not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get heater error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/heaters', authMiddleware(['admin', 'electrician']), async (req, res) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { premise_id, serial, name, power_kw, power_w, elements, heating_element,
            manufacture_date, decommission_date, inventory_number, voltage_v,
            protection_type, installation_location, status, sticker_number } = req.body;
    if (!name) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Name required' });
    }

    // If no premise_id, force warehouse status
    const finalStatus = (!premise_id || premise_id === null) ? 'warehouse' : (status || 'active');
    const finalPremiseId = (!premise_id || premise_id === null) ? null : premise_id;

    // Auto-generate sticker number if not provided
    let nextStickerNum;
    if (sticker_number) {
      nextStickerNum = sticker_number;
    } else {
      const stickerResult = await client.query(
        'SELECT COALESCE(MAX(CAST(number AS INTEGER)), 0) + 1 as next_num FROM stickers'
      );
      nextStickerNum = String(stickerResult.rows[0].next_num).padStart(3, '0');
    }

    const heaterResult = await client.query(
      `INSERT INTO heaters (premise_id, serial, name, power_kw, power_w, elements, heating_element,
            manufacture_date, decommission_date, inventory_number, voltage_v, protection_type, 
            installation_location, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [finalPremiseId, serial || null, name, power_kw || null, power_w || null, elements || null, 
       heating_element || null, manufacture_date || null, decommission_date || null, 
       inventory_number || null, voltage_v || 220, protection_type || null,
       installation_location || null, finalStatus]
    );
    const heater = heaterResult.rows[0];

    await client.query(
      'INSERT INTO stickers (heater_id, number, electrician_id) VALUES ($1, $2, $3)',
      [heater.id, nextStickerNum, req.user.id]
    );

    // Log creation event
    await client.query(
      `INSERT INTO heater_events (heater_id, user_id, event_type, new_status, comment)
       VALUES ($1, $2, 'status_change', $3, $4)`,
      [heater.id, req.user.id, finalStatus, 'Создана карточка обогревателя']
    );
    
    // If created without premise, log warehouse move
    if (!finalPremiseId) {
      await client.query(
        `INSERT INTO heater_events (heater_id, user_id, event_type, new_status, comment)
         VALUES ($1, $2, 'premise_change', $3, $4)`,
        [heater.id, req.user.id, 'warehouse', 'Обогреватель перемещён на склад']
      );
    }

    await client.query('COMMIT');
    res.status(201).json(heater);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create heater error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

router.put('/heaters/:id', authMiddleware(['admin', 'electrician']), async (req, res) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const { premise_id, serial, name, power_kw, power_w, elements, heating_element,
            manufacture_date, decommission_date, inventory_number, voltage_v,
            protection_type, installation_location, status, photo_url } = req.body;

    // Get current heater data
    const currentResult = await client.query('SELECT * FROM heaters WHERE id = $1', [id]);
    if (currentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Heater not found' });
    }
    const current = currentResult.rows[0];

    const updates = [];
    const params = [];
    let paramIndex = 1;

    // Track if premise_id is being updated
    let premiseIdUpdated = false;

    // Handle status change first (may affect premise_id)
    if (status !== undefined && status !== current.status) {
      updates.push(`status = $${paramIndex++}`);
      params.push(status);
      
      let comment = '';
      if (status === 'warehouse' && current.status !== 'warehouse') {
        comment = 'Обогреватель перемещён на склад';
        // Clear premise_id when moving to warehouse (if not already null)
        if (current.premise_id !== null) {
          premiseIdUpdated = true;
          updates.push(`premise_id = $${paramIndex++}`);
          params.push(null);
        }
      } else if (status === 'repair' && current.status !== 'repair') {
        comment = 'Обогреватель перемещён в ремонт';
      } else {
        const statusNames = {
          'active': 'активен',
          'repair': 'в ремонте',
          'warehouse': 'на складе',
          'moved': 'перемещён'
        };
        const oldStatusName = statusNames[current.status] || current.status;
        const newStatusName = statusNames[status] || status;
        comment = `Статус изменён с "${oldStatusName}" на "${newStatusName}"`;
      }
      
      await client.query(
        `INSERT INTO heater_events (heater_id, user_id, event_type, old_status, new_status, comment)
         VALUES ($1, $2, 'status_change', $3, $4, $5)`,
        [id, req.user.id, current.status, status, comment]
      );
    }

    // Handle premise change (only if not already updated due to warehouse status)
    if (!premiseIdUpdated && premise_id !== current.premise_id) {
      updates.push(`premise_id = $${paramIndex++}`);
      params.push(premise_id);

      if (premise_id) {
        const premiseResult = await client.query('SELECT name FROM premises WHERE id = $1', [premise_id]);
        const premiseName = premiseResult.rows[0]?.name || 'неизвестное';
        await client.query(
          `INSERT INTO heater_events (heater_id, user_id, event_type, from_premise_id, to_premise_id, comment)
           VALUES ($1, $2, 'premise_change', $3, $4, $5)`,
          [id, req.user.id, current.premise_id, premise_id, `Обогреватель перемещён в ${premiseName}`]
        );
      }
    }

    // Handle other field updates
    if (serial !== undefined && serial !== current.serial) { updates.push(`serial = $${paramIndex++}`); params.push(serial); }
    if (name !== undefined && name !== current.name) { updates.push(`name = $${paramIndex++}`); params.push(name); }
    if (power_kw !== current.power_kw) { updates.push(`power_kw = $${paramIndex++}`); params.push(power_kw); }
    if (power_w !== current.power_w) { updates.push(`power_w = $${paramIndex++}`); params.push(power_w); }
    if (elements !== current.elements) { updates.push(`elements = $${paramIndex++}`); params.push(elements); }
    if (heating_element !== current.heating_element) { updates.push(`heating_element = $${paramIndex++}`); params.push(heating_element); }
    if (manufacture_date !== current.manufacture_date) { updates.push(`manufacture_date = $${paramIndex++}`); params.push(manufacture_date); }
    if (decommission_date !== current.decommission_date) { updates.push(`decommission_date = $${paramIndex++}`); params.push(decommission_date); }
    if (inventory_number !== current.inventory_number) { updates.push(`inventory_number = $${paramIndex++}`); params.push(inventory_number); }
    if (voltage_v !== current.voltage_v) { updates.push(`voltage_v = $${paramIndex++}`); params.push(voltage_v); }
    if (protection_type !== current.protection_type) { updates.push(`protection_type = $${paramIndex++}`); params.push(protection_type); }
    if (installation_location !== current.installation_location) { updates.push(`installation_location = $${paramIndex++}`); params.push(installation_location); }
    if (photo_url !== current.photo_url) { updates.push(`photo_url = $${paramIndex++}`); params.push(photo_url); }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(id);

    if (updates.length === 0) {
      await client.query('ROLLBACK');
      return res.json(current);
    }

    const result = await client.query(
      `UPDATE heaters SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update heater error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.delete('/heaters/:id', authMiddleware(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    // Soft delete
    await query('UPDATE heaters SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
    res.status(204).send();
  } catch (err) {
    console.error('Delete heater error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Restore deleted heater
router.post('/heaters/:id/restore', authMiddleware(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    await query('UPDATE heaters SET deleted_at = NULL WHERE id = $1', [id]);
    const result = await query('SELECT * FROM heaters WHERE id = $1', [id]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Restore heater error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export database to JSON
router.get('/export', authMiddleware(['admin']), async (req, res) => {
  try {
    const [objects, premises, heaters, stickers, events, users] = await Promise.all([
      query('SELECT * FROM objects ORDER BY id'),
      query('SELECT * FROM premises ORDER BY id'),
      query('SELECT * FROM heaters ORDER BY id'),
      query('SELECT * FROM stickers ORDER BY id'),
      query('SELECT * FROM heater_events ORDER BY id'),
      query('SELECT id, login, role, created_at FROM users ORDER BY id')
    ]);
    
    const exportData = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      objects: objects.rows,
      premises: premises.rows,
      heaters: heaters.rows,
      stickers: stickers.rows,
      events: events.rows,
      users: users.rows
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="electro-backup.json"');
    res.json(exportData);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Import database from JSON
router.post('/import', authMiddleware(['admin']), async (req, res) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    const data = req.body;
    let imported = { objects: 0, premises: 0, heaters: 0, stickers: 0, events: 0, users: 0 };
    
    // Import objects
    if (data.objects) {
      for (const obj of data.objects) {
        await client.query(
          `INSERT INTO objects (id, name, code, created_at, deleted_at) 
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET name=$2, code=$3, deleted_at=$5`,
          [obj.id, obj.name, obj.code, obj.created_at, obj.deleted_at]
        );
        imported.objects++;
      }
    }
    
    // Import premises
    if (data.premises) {
      for (const p of data.premises) {
        await client.query(
          `INSERT INTO premises (id, object_id, name, number, type, created_at, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET object_id=$2, name=$3, number=$4, type=$5, deleted_at=$7`,
          [p.id, p.object_id, p.name, p.number, p.type, p.created_at, p.deleted_at]
        );
        imported.premises++;
      }
    }
    
    // Import heaters
    if (data.heaters) {
      for (const h of data.heaters) {
        await client.query(
          `INSERT INTO heaters (id, premise_id, serial, name, power_kw, power_w, elements, heating_element,
            manufacture_date, decommission_date, inventory_number, voltage_v, protection_type, 
            installation_location, status, created_at, updated_at, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
           ON CONFLICT (id) DO UPDATE SET premise_id=$2, serial=$3, name=$4, status=$15, deleted_at=$18`,
          [h.id, h.premise_id, h.serial, h.name, h.power_kw, h.power_w, h.elements, h.heating_element,
           h.manufacture_date, h.decommission_date, h.inventory_number, h.voltage_v, h.protection_type,
           h.installation_location, h.status, h.created_at, h.updated_at, h.deleted_at]
        );
        imported.heaters++;
      }
    }
    
    // Import stickers
    if (data.stickers) {
      for (const s of data.stickers) {
        await client.query(
          `INSERT INTO stickers (id, heater_id, number, check_date, electrician_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET heater_id=$2, number=$3, check_date=$4`,
          [s.id, s.heater_id, s.number, s.check_date, s.electrician_id, s.created_at]
        );
        imported.stickers++;
      }
    }
    
    // Import events
    if (data.events) {
      for (const e of data.events) {
        await client.query(
          `INSERT INTO heater_events (id, heater_id, user_id, event_type, from_premise_id, to_premise_id,
            old_status, new_status, comment, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO UPDATE SET event_type=$4, comment=$9`,
          [e.id, e.heater_id, e.user_id, e.event_type, e.from_premise_id, e.to_premise_id,
           e.old_status, e.new_status, e.comment, e.created_at]
        );
        imported.events++;
      }
    }
    
    await client.query('COMMIT');
    res.json({ success: true, imported });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Import error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Stickers
router.get('/stickers', authMiddleware(), async (req, res) => {
  try {
    const { heater_id } = req.query;
    let sql = `
      SELECT s.*, u.login as electrician_name, h.name as heater_name
      FROM stickers s
      LEFT JOIN users u ON s.electrician_id = u.id
      LEFT JOIN heaters h ON s.heater_id = h.id
      WHERE 1=1
    `;
    const params = [];
    if (heater_id) {
      sql += ' AND s.heater_id = $1';
      params.push(heater_id);
    }
    sql += ' ORDER BY s.created_at DESC';
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get stickers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/stickers', authMiddleware(['admin', 'electrician']), async (req, res) => {
  try {
    const { heater_id, number, check_date } = req.body;
    if (!heater_id) {
      return res.status(400).json({ error: 'Heater ID required' });
    }
    const result = await query(
      'INSERT INTO stickers (heater_id, number, check_date, electrician_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [heater_id, number, check_date || null, req.user.id]
    );
    
    await query(
      `INSERT INTO heater_events (heater_id, user_id, event_type, comment) 
       VALUES ($1, $2, 'sticker_applied', $3)`,
      [heater_id, req.user.id, `Sticker ${number} applied`]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create sticker error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Events (heater history)
router.get('/events', authMiddleware(), async (req, res) => {
  try {
    const { heater_id, event_type, limit } = req.query;
    let sql = `
      SELECT e.*, u.login as user_name, h.name as heater_name,
             fp.name as from_premise_name, tp.name as to_premise_name
      FROM heater_events e
      LEFT JOIN users u ON e.user_id = u.id
      LEFT JOIN heaters h ON e.heater_id = h.id
      LEFT JOIN premises fp ON e.from_premise_id = fp.id
      LEFT JOIN premises tp ON e.to_premise_id = tp.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (heater_id) {
      sql += ` AND e.heater_id = $${paramIndex++}`;
      params.push(heater_id);
    }
    if (event_type) {
      sql += ` AND e.event_type = $${paramIndex++}`;
      params.push(event_type);
    }
    sql += ' ORDER BY e.created_at DESC';
    if (limit) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(parseInt(limit));
    }
    
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get events error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// File upload
router.post('/upload', authMiddleware(['admin', 'electrician']), upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const photoUrl = `/uploads/${req.file.filename}`;
    res.json({ photo_url: photoUrl });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== НОВЫЙ ENDPOINT СИНХРОНИЗАЦИИ (UUID-based) =====
const { setupSyncEndpoint } = require('./sync-endpoint');
setupSyncEndpoint(router);

// Get all stickers
router.get('/stickers', authMiddleware(), async (req, res) => {
  try {
    const result = await query('SELECT * FROM stickers ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Get stickers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all events
router.get('/events', authMiddleware(), async (req, res) => {
  try {
    const { heater_id, limit } = req.query;
    let sql = `
      SELECT e.*, u.login as user_name, h.name as heater_name,
             fp.name as from_premise_name, tp.name as to_premise_name
      FROM heater_events e
      LEFT JOIN users u ON e.user_id = u.id
      LEFT JOIN heaters h ON e.heater_id = h.id
      LEFT JOIN premises fp ON e.from_premise_id = fp.id
      LEFT JOIN premises tp ON e.to_premise_id = tp.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (heater_id) {
      sql += ` AND e.heater_id = $${paramIndex++}`;
      params.push(heater_id);
    }
    sql += ' ORDER BY e.created_at DESC';
    if (limit) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(parseInt(limit));
    }
    
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get events error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
