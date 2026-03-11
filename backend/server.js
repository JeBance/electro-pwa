const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { ensureAdminUser } = require('./auth');

const PORT = process.env.PORT || 3000;
const app = express();

// CORS - allow all local addresses and production domain
app.use(cors({
  origin: true, // Allow all origins for now
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));
app.use('/uploads', express.static(path.join(publicDir, 'uploads')));

// Ensure uploads directory exists
const uploadsDir = path.join(publicDir, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// API routes
const apiRouter = require('./api');
app.use('/api', apiRouter);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize and start
async function start() {
  try {
    await ensureAdminUser();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Frontend: http://localhost:${PORT}`);
      console.log(`API: http://localhost:${PORT}/api`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
