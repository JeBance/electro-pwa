const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { query } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'electro-jwt-secret-change-in-production';
const TOKEN_EXPIRY = '24h';

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

async function generateToken(user) {
  return jwt.sign(
    { id: user.id, login: user.login, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

function authMiddleware(requiredRoles = []) {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    if (requiredRoles.length > 0 && !requiredRoles.includes(decoded.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }

    req.user = decoded;
    next();
  };
}

async function createUser(login, password, role = 'commander') {
  const passwordHash = await hashPassword(password);
  const result = await query(
    'INSERT INTO users (login, password_hash, role) VALUES ($1, $2, $3) RETURNING id, login, role, created_at',
    [login, passwordHash, role]
  );
  return result.rows[0];
}

async function getUserByLogin(login) {
  const result = await query('SELECT * FROM users WHERE login = $1', [login]);
  return result.rows[0];
}

async function validateUser(login, password) {
  const user = await getUserByLogin(login);
  if (!user) return null;
  
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return null;
  
  return {
    id: user.id,
    login: user.login,
    role: user.role,
    created_at: user.created_at
  };
}

async function getAllUsers() {
  const result = await query('SELECT id, login, role, created_at FROM users ORDER BY created_at');
  return result.rows;
}

async function updateUserRole(userId, role) {
  const result = await query(
    'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, login, role, created_at',
    [role, userId]
  );
  return result.rows[0];
}

async function deleteUser(userId) {
  await query('DELETE FROM users WHERE id = $1', [userId]);
}

async function ensureAdminUser() {
  const existing = await getUserByLogin('admin');
  if (!existing) {
    await createUser('admin', 'admin123', 'admin');
    console.log('Default admin user created: admin / admin123');
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  authMiddleware,
  createUser,
  getUserByLogin,
  validateUser,
  getAllUsers,
  updateUserRole,
  deleteUser,
  ensureAdminUser,
  JWT_SECRET
};
