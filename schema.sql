-- ════════════════════════════════════════════════════════════════
--  SUPABASE DATABASE SCHEMA — Anansi City Server Emulator
--  Run this SQL in your Supabase SQL Editor to create the tables
-- ════════════════════════════════════════════════════════════════

-- 1. Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Players table
CREATE TABLE IF NOT EXISTS players (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  nickname TEXT,
  device_id TEXT,
  password_hash TEXT,
  level INTEGER DEFAULT 1,
  gold BIGINT DEFAULT 1000,
  diamond BIGINT DEFAULT 100,
  exp BIGINT DEFAULT 0,
  vip_level INTEGER DEFAULT 0,
  reputation INTEGER DEFAULT 0,
  honor INTEGER DEFAULT 0,
  last_login TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  session_token TEXT,
  token TEXT,
  ban_until TIMESTAMPTZ,
  is_banned BOOLEAN DEFAULT FALSE
);

-- Index for fast login lookups
CREATE INDEX IF NOT EXISTS idx_players_username ON players(username);
CREATE INDEX IF NOT EXISTS idx_players_device_id ON players(device_id);
CREATE INDEX IF NOT EXISTS idx_players_session ON players(session_token);

-- 3. Player inventory
CREATE TABLE IF NOT EXISTS player_inventory (
  id BIGSERIAL PRIMARY KEY,
  player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'item',
  count INTEGER NOT NULL DEFAULT 1,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_player ON player_inventory(player_id);

-- 4. Player progress (missions, achievements)
CREATE TABLE IF NOT EXISTS player_progress (
  id BIGSERIAL PRIMARY KEY,
  player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  progress_type TEXT NOT NULL,  -- 'mission', 'achievement', 'dungeon', etc.
  progress_id INTEGER NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  progress INTEGER DEFAULT 0,
  stars INTEGER DEFAULT 0,
  data JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_progress_unique 
  ON player_progress(player_id, progress_type, progress_id);

-- 5. Server log
CREATE TABLE IF NOT EXISTS server_log (
  id BIGSERIAL PRIMARY KEY,
  player_id BIGINT REFERENCES players(id),
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_progress ENABLE ROW LEVEL SECURITY;

-- Allow service_role full access (this is for your backend)
CREATE POLICY "Service role full access" ON players
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON player_inventory
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON player_progress
  FOR ALL USING (true) WITH CHECK (true);
