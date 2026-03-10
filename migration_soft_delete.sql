-- Migration: Add soft delete and export/import support
-- Run: psql -d electro -f migration_soft_delete.sql

-- Add deleted_at column to all main tables
ALTER TABLE objects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE premises ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE heaters ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Create indexes for deleted_at
CREATE INDEX IF NOT EXISTS idx_objects_deleted ON objects(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_premises_deleted ON premises(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_heaters_deleted ON heaters(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(deleted_at) WHERE deleted_at IS NOT NULL;

-- Update existing queries to filter out deleted records (optional, can be done in app)
-- For now we handle it in the application layer

COMMENT ON COLUMN objects.deleted_at IS 'Soft delete timestamp - NULL means active';
COMMENT ON COLUMN premises.deleted_at IS 'Soft delete timestamp - NULL means active';
COMMENT ON COLUMN heaters.deleted_at IS 'Soft delete timestamp - NULL means active';
COMMENT ON COLUMN users.deleted_at IS 'Soft delete timestamp - NULL means active';
