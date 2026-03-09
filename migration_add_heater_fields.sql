-- Migration: Add missing heater fields
-- Run: psql -d electro -f migration_add_heater_fields.sql

-- Add new columns to heaters table
ALTER TABLE heaters ADD COLUMN IF NOT EXISTS inventory_number VARCHAR(50);
ALTER TABLE heaters ADD COLUMN IF NOT EXISTS decommission_date DATE;
ALTER TABLE heaters ADD COLUMN IF NOT EXISTS voltage_v INTEGER DEFAULT 220;
ALTER TABLE heaters ADD COLUMN IF NOT EXISTS power_w INTEGER;
ALTER TABLE heaters ADD COLUMN IF NOT EXISTS heating_element VARCHAR(100);
ALTER TABLE heaters ADD COLUMN IF NOT EXISTS protection_type VARCHAR(50);
ALTER TABLE heaters ADD COLUMN IF NOT EXISTS installation_location TEXT;

-- Update power_w from power_kw if exists
UPDATE heaters SET power_w = (power_kw * 1000)::INTEGER WHERE power_kw IS NOT NULL AND power_w IS NULL;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_heaters_inventory ON heaters(inventory_number);
CREATE INDEX IF NOT EXISTS idx_heaters_decommission ON heaters(decommission_date);
