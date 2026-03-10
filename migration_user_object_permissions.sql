-- Migration: Add user object visibility permissions
-- Run: psql -d electro -f migration_user_object_permissions.sql

-- Table for user-object visibility permissions
CREATE TABLE IF NOT EXISTS user_objects (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    object_id INTEGER REFERENCES objects(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, object_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_objects_user ON user_objects(user_id);
CREATE INDEX IF NOT EXISTS idx_user_objects_object ON user_objects(object_id);

-- Comment
COMMENT ON TABLE user_objects IS 'User-object visibility permissions';
COMMENT ON COLUMN user_objects.user_id IS 'User ID';
COMMENT ON COLUMN user_objects.object_id IS 'Object ID that user can access';
