-- ELECTRO PWA Database Schema
-- PostgreSQL migration file
-- Полная схема с поддержкой UUID и soft delete

-- Включаем расширение для генерации UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===== Users table =====
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid(),
    login VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'commander' CHECK (role IN ('admin', 'electrician', 'commander')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE,
    synced_at TIMESTAMP WITH TIME ZONE
);

-- ===== Objects (enterprises, facilities) =====
CREATE TABLE IF NOT EXISTS objects (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    code VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE,
    synced_at TIMESTAMP WITH TIME ZONE
);

-- ===== Premises (wagons, rooms, buildings) =====
CREATE TABLE IF NOT EXISTS premises (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid(),
    object_id INTEGER REFERENCES objects(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    number VARCHAR(20),
    type VARCHAR(20) DEFAULT 'wagon' CHECK (type IN ('wagon', 'room', 'building')),
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE,
    synced_at TIMESTAMP WITH TIME ZONE
);

-- ===== Heaters =====
CREATE TABLE IF NOT EXISTS heaters (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid(),
    premise_id INTEGER REFERENCES premises(id) ON DELETE SET NULL,
    serial VARCHAR(100),
    name VARCHAR(100) NOT NULL,
    power_kw DECIMAL(8,2),
    power_w INTEGER,
    elements INTEGER,
    voltage_v INTEGER,
    heating_element VARCHAR(100),
    protection_type VARCHAR(100),
    manufacture_date DATE,
    decommission_date DATE,
    inventory_number VARCHAR(100),
    installation_location TEXT,
    photo_url VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'repair', 'warehouse', 'moved')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE,
    synced_at TIMESTAMP WITH TIME ZONE
);

-- ===== Stickers (labels applied to heaters) =====
CREATE TABLE IF NOT EXISTS stickers (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid(),
    heater_id INTEGER REFERENCES heaters(id) ON DELETE CASCADE,
    number VARCHAR(10) NOT NULL,
    check_date DATE,
    electrician_id INTEGER REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    synced_at TIMESTAMP WITH TIME ZONE
);

-- ===== Heater events (history log) =====
CREATE TABLE IF NOT EXISTS heater_events (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid(),
    heater_id INTEGER REFERENCES heaters(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    event_type VARCHAR(30) NOT NULL CHECK (event_type IN ('status_change', 'premise_change', 'sticker_applied', 'photo_updated')),
    from_premise_id INTEGER REFERENCES premises(id),
    to_premise_id INTEGER REFERENCES premises(id),
    old_status VARCHAR(20),
    new_status VARCHAR(20),
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    synced_at TIMESTAMP WITH TIME ZONE
);

-- ===== Sync log (for offline operations) =====
CREATE TABLE IF NOT EXISTS sync_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    payload JSONB,
    synced BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    response JSONB
);

-- ===== User object permissions =====
CREATE TABLE IF NOT EXISTS user_objects (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    object_id INTEGER REFERENCES objects(id) ON DELETE CASCADE,
    UNIQUE(user_id, object_id)
);

-- ===== Indexes for performance =====
-- Heaters
CREATE INDEX IF NOT EXISTS idx_heaters_premise ON heaters(premise_id);
CREATE INDEX IF NOT EXISTS idx_heaters_status ON heaters(status);
CREATE INDEX IF NOT EXISTS idx_heaters_uuid ON heaters(uuid);
CREATE INDEX IF NOT EXISTS idx_heaters_sync ON heaters(created_at, synced_at);
CREATE INDEX IF NOT EXISTS idx_heaters_deleted ON heaters(deleted_at) WHERE deleted_at IS NOT NULL;

-- Premises
CREATE INDEX IF NOT EXISTS idx_premises_object ON premises(object_id);
CREATE INDEX IF NOT EXISTS idx_premises_uuid ON premises(uuid);
CREATE INDEX IF NOT EXISTS idx_premises_sync ON premises(created_at, synced_at);
CREATE INDEX IF NOT EXISTS idx_premises_deleted ON premises(deleted_at) WHERE deleted_at IS NOT NULL;

-- Objects
CREATE INDEX IF NOT EXISTS idx_objects_uuid ON objects(uuid);
CREATE INDEX IF NOT EXISTS idx_objects_sync ON objects(created_at, synced_at);
CREATE INDEX IF NOT EXISTS idx_objects_deleted ON objects(deleted_at) WHERE deleted_at IS NOT NULL;

-- Users
CREATE INDEX IF NOT EXISTS idx_users_uuid ON users(uuid);
CREATE INDEX IF NOT EXISTS idx_users_sync ON users(created_at, synced_at);
CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(deleted_at) WHERE deleted_at IS NOT NULL;

-- Stickers
CREATE INDEX IF NOT EXISTS idx_stickers_heater ON stickers(heater_id);
CREATE INDEX IF NOT EXISTS idx_stickers_uuid ON stickers(uuid);
CREATE INDEX IF NOT EXISTS idx_stickers_sync ON stickers(created_at, synced_at);

-- Heater events
CREATE INDEX IF NOT EXISTS idx_events_heater ON heater_events(heater_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON heater_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_uuid ON heater_events(uuid);
CREATE INDEX IF NOT EXISTS idx_events_sync ON heater_events(created_at, synced_at);

-- Sync log
CREATE INDEX IF NOT EXISTS idx_sync_log_user ON sync_log(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_synced ON sync_log(synced);

-- ===== Comments =====
COMMENT ON COLUMN users.uuid IS 'Уникальный идентификатор для синхронизации';
COMMENT ON COLUMN users.deleted_at IS 'Soft delete timestamp - NULL означает активную запись';
COMMENT ON COLUMN users.synced_at IS 'Время последней синхронизации';

COMMENT ON COLUMN objects.uuid IS 'Уникальный идентификатор для синхронизации';
COMMENT ON COLUMN objects.deleted_at IS 'Soft delete timestamp - NULL означает активную запись';
COMMENT ON COLUMN objects.synced_at IS 'Время последней синхронизации';

COMMENT ON COLUMN premises.uuid IS 'Уникальный идентификатор для синхронизации';
COMMENT ON COLUMN premises.deleted_at IS 'Soft delete timestamp - NULL означает активную запись';
COMMENT ON COLUMN premises.synced_at IS 'Время последней синхронизации';
COMMENT ON COLUMN premises.note IS 'Заметка для помещения';

COMMENT ON COLUMN heaters.uuid IS 'Уникальный идентификатор для синхронизации';
COMMENT ON COLUMN heaters.deleted_at IS 'Soft delete timestamp - NULL означает активную запись';
COMMENT ON COLUMN heaters.synced_at IS 'Время последней синхронизации';

COMMENT ON COLUMN stickers.uuid IS 'Уникальный идентификатор для синхронизации';
COMMENT ON COLUMN stickers.synced_at IS 'Время последней синхронизации';

COMMENT ON COLUMN heater_events.uuid IS 'Уникальный идентификатор для синхронизации';
COMMENT ON COLUMN heater_events.synced_at IS 'Время последней синхронизации';

COMMENT ON COLUMN sync_log.payload IS 'JSON payload от клиента';
COMMENT ON COLUMN sync_log.response IS 'JSON ответ сервера';

-- ===== Create default admin user =====
-- The password hash is generated by the application on first run
-- This is handled by auth.js ensureAdminUser() function
