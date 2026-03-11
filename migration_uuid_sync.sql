-- Миграция: Добавление UUID и полей синхронизации
-- Дата: 2026-03-11
-- Описание: Упрощение синхронизации между фронтендом и бэкендом

-- Включаем расширение для генерации UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===== heaters =====
ALTER TABLE heaters ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();
ALTER TABLE heaters ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

-- Индекс для быстрой синхронизации
CREATE INDEX IF NOT EXISTS idx_heaters_sync ON heaters (created_at, synced_at);
CREATE INDEX IF NOT EXISTS idx_heaters_uuid ON heaters (uuid);

-- ===== premises =====
ALTER TABLE premises ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();
ALTER TABLE premises ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_premises_sync ON premises (created_at, synced_at);
CREATE INDEX IF NOT EXISTS idx_premises_uuid ON premises (uuid);

-- ===== objects =====
ALTER TABLE objects ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();
ALTER TABLE objects ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_objects_sync ON objects (created_at, synced_at);
CREATE INDEX IF NOT EXISTS idx_objects_uuid ON objects (uuid);

-- ===== users =====
ALTER TABLE users ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();
ALTER TABLE users ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_sync ON users (created_at, synced_at);
CREATE INDEX IF NOT EXISTS idx_users_uuid ON users (uuid);

-- ===== stickers =====
ALTER TABLE stickers ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();
ALTER TABLE stickers ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_stickers_sync ON stickers (created_at, synced_at);
CREATE INDEX IF NOT EXISTS idx_stickers_uuid ON stickers (uuid);

-- ===== heater_events =====
ALTER TABLE heater_events ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();
ALTER TABLE heater_events ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_events_sync ON heater_events (created_at, synced_at);
CREATE INDEX IF NOT EXISTS idx_events_uuid ON heater_events (uuid);

-- ===== sync_log =====
-- Таблица для логирования операций синхронизации
CREATE TABLE IF NOT EXISTS sync_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    payload JSONB,
    synced BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    response JSONB
);

CREATE INDEX IF NOT EXISTS idx_sync_log_user ON sync_log (user_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_synced ON sync_log (synced);

-- ===== Обновление существующих записей =====
-- Устанавливаем synced_at = created_at для существующих записей
UPDATE heaters SET synced_at = created_at WHERE synced_at IS NULL;
UPDATE premises SET synced_at = created_at WHERE synced_at IS NULL;
UPDATE objects SET synced_at = created_at WHERE synced_at IS NULL;
UPDATE users SET synced_at = created_at WHERE synced_at IS NULL;
UPDATE stickers SET synced_at = created_at WHERE synced_at IS NULL;
UPDATE heater_events SET synced_at = created_at WHERE synced_at IS NULL;
