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
    const result = await query('SELECT * FROM objects ORDER BY name');
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
    await query('DELETE FROM objects WHERE id = $1', [id]);
    res.status(204).send();
  } catch (err) {
    console.error('Delete object error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Premises
router.get('/premises', authMiddleware(), async (req, res) => {
  try {
    const { object_id } = req.query;
    let sql = `
      SELECT p.*, o.name as object_name 
      FROM premises p 
      LEFT JOIN objects o ON p.object_id = o.id 
      ORDER BY o.name, p.name
    `;
    const params = [];
    if (object_id) {
      sql = `
        SELECT p.*, o.name as object_name 
        FROM premises p 
        LEFT JOIN objects o ON p.object_id = o.id 
        WHERE p.object_id = $1 
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
  try {
    const { id } = req.params;
    await query('DELETE FROM premises WHERE id = $1', [id]);
    res.status(204).send();
  } catch (err) {
    console.error('Delete premise error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Heaters
router.get('/heaters', authMiddleware(), async (req, res) => {
  try {
    const { premise_id, status, search } = req.query;
    let sql = `
      SELECT h.*, p.name as premise_name, p.number as premise_number, 
             o.name as object_name, o.id as object_id
      FROM heaters h
      LEFT JOIN premises p ON h.premise_id = p.id
      LEFT JOIN objects o ON p.object_id = o.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
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
      sql += ` AND (h.name ILIKE $${paramIndex} OR h.serial ILIKE $${paramIndex})`;
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
             o.name as object_name, o.id as object_id
      FROM heaters h
      LEFT JOIN premises p ON h.premise_id = p.id
      LEFT JOIN objects o ON p.object_id = o.id
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
            protection_type, installation_location, status } = req.body;
    if (!premise_id || !name) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Premise ID and name required' });
    }

    // Auto-generate sticker number
    const stickerResult = await client.query(
      'SELECT COALESCE(MAX(CAST(number AS INTEGER)), 0) + 1 as next_num FROM stickers'
    );
    const nextStickerNum = String(stickerResult.rows[0].next_num).padStart(3, '0');

    const heaterResult = await client.query(
      `INSERT INTO heaters (premise_id, serial, name, power_kw, power_w, elements, heating_element,
            manufacture_date, decommission_date, inventory_number, voltage_v, protection_type, 
            installation_location, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [premise_id, serial || null, name, power_kw || null, power_w || null, elements || null, 
       heating_element || null, manufacture_date || null, decommission_date || null, 
       inventory_number || null, voltage_v || 220, protection_type || null, 
       installation_location || null, status || 'active']
    );
    const heater = heaterResult.rows[0];

    await client.query(
      'INSERT INTO stickers (heater_id, number, electrician_id) VALUES ($1, $2, $3)',
      [heater.id, nextStickerNum, req.user.id]
    );
    
    await client.query(
      `INSERT INTO heater_events (heater_id, user_id, event_type, new_status, comment) 
       VALUES ($1, $2, 'status_change', $3, $4)`,
      [heater.id, req.user.id, heater.status, 'Initial status']
    );
    
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

    if (premise_id !== undefined && premise_id !== current.premise_id) {
      updates.push(`premise_id = $${paramIndex++}`);
      params.push(premise_id);
      await client.query(
        `INSERT INTO heater_events (heater_id, user_id, event_type, from_premise_id, to_premise_id, comment)
         VALUES ($1, $2, 'premise_change', $3, $4, $5)`,
        [id, req.user.id, current.premise_id, premise_id, `Moved from ${current.premise_id} to ${premise_id}`]
      );
    }
    if (serial !== undefined) { updates.push(`serial = $${paramIndex++}`); params.push(serial); }
    if (name !== undefined) { updates.push(`name = $${paramIndex++}`); params.push(name); }
    if (power_kw !== undefined) { updates.push(`power_kw = $${paramIndex++}`); params.push(power_kw); }
    if (power_w !== undefined) { updates.push(`power_w = $${paramIndex++}`); params.push(power_w); }
    if (elements !== undefined) { updates.push(`elements = $${paramIndex++}`); params.push(elements); }
    if (heating_element !== undefined) { updates.push(`heating_element = $${paramIndex++}`); params.push(heating_element); }
    if (manufacture_date !== undefined) { updates.push(`manufacture_date = $${paramIndex++}`); params.push(manufacture_date); }
    if (decommission_date !== undefined) { updates.push(`decommission_date = $${paramIndex++}`); params.push(decommission_date); }
    if (inventory_number !== undefined) { updates.push(`inventory_number = $${paramIndex++}`); params.push(inventory_number); }
    if (voltage_v !== undefined) { updates.push(`voltage_v = $${paramIndex++}`); params.push(voltage_v); }
    if (protection_type !== undefined) { updates.push(`protection_type = $${paramIndex++}`); params.push(protection_type); }
    if (installation_location !== undefined) { updates.push(`installation_location = $${paramIndex++}`); params.push(installation_location); }
    if (photo_url !== undefined) { updates.push(`photo_url = $${paramIndex++}`); params.push(photo_url); }

    if (status !== undefined && status !== current.status) {
      updates.push(`status = $${paramIndex++}`);
      params.push(status);
      await client.query(
        `INSERT INTO heater_events (heater_id, user_id, event_type, old_status, new_status, comment)
         VALUES ($1, $2, 'status_change', $3, $4, $5)`,
        [id, req.user.id, current.status, status, `Status changed from ${current.status} to ${status}`]
      );
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(id);

    const result = await client.query(
      `UPDATE heaters SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update heater error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

router.delete('/heaters/:id', authMiddleware(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM heaters WHERE id = $1', [id]);
    res.status(204).send();
  } catch (err) {
    console.error('Delete heater error:', err);
    res.status(500).json({ error: 'Internal server error' });
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

// Sync endpoint for offline operations
router.post('/sync', authMiddleware(), async (req, res) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    const { operations } = req.body;
    const results = [];
    
    for (const op of operations) {
      const { action, endpoint, method, data } = op;
      
      await client.query(
        `INSERT INTO sync_log (user_id, action, payload, synced) VALUES ($1, $2, $3, true)`,
        [req.user.id, action, JSON.stringify(data)]
      );
      
      results.push({ action, success: true });
    }
    
    await client.query('COMMIT');
    res.json({ results });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Sync error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
