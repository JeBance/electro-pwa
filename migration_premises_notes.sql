-- Migration: Add notes to premises table
-- Run: psql -d electro -f migration_premises_notes.sql

-- Add note column to premises
ALTER TABLE premises ADD COLUMN IF NOT EXISTS note TEXT;

-- Comment
COMMENT ON COLUMN premises.note IS 'Note/comment for the premise (wagon, room, etc.)';
