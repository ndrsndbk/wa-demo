-- =====================================================
-- QMUNITY QUEUE - SUPABASE SCHEMA
-- Community crowd-reporting for Home Affairs queues
-- Run this in Supabase SQL Editor
-- =====================================================

-- ===========================================
-- TABLE 1: qmunity_locations
-- Stores location metadata (single location for prototype)
-- ===========================================
CREATE TABLE IF NOT EXISTS qmunity_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  max_capacity INTEGER NOT NULL DEFAULT 25,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qmunity_locations_slug ON qmunity_locations(slug);
CREATE INDEX IF NOT EXISTS idx_qmunity_locations_active ON qmunity_locations(is_active) WHERE is_active = true;

-- ===========================================
-- TABLE 2: qmunity_checkins
-- Stores queue number reports from users
-- ===========================================
CREATE TABLE IF NOT EXISTS qmunity_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES qmunity_locations(id) ON DELETE CASCADE,
  wa_from TEXT NOT NULL,
  queue_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT qmunity_checkins_queue_number_check CHECK (queue_number >= 1 AND queue_number <= 999)
);

CREATE INDEX IF NOT EXISTS idx_qmunity_checkins_location_created
  ON qmunity_checkins(location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qmunity_checkins_wa_from
  ON qmunity_checkins(wa_from);
CREATE INDEX IF NOT EXISTS idx_qmunity_checkins_created_at
  ON qmunity_checkins(created_at DESC);

-- ===========================================
-- TABLE 3: qmunity_speed_reports
-- Stores speed reports (QUICKLY / MODERATELY / SLOW)
-- ===========================================
CREATE TABLE IF NOT EXISTS qmunity_speed_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES qmunity_locations(id) ON DELETE CASCADE,
  wa_from TEXT NOT NULL,
  speed TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT qmunity_speed_reports_speed_check CHECK (speed IN ('QUICKLY', 'MODERATELY', 'SLOW'))
);

CREATE INDEX IF NOT EXISTS idx_qmunity_speed_reports_location_created
  ON qmunity_speed_reports(location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qmunity_speed_reports_wa_from
  ON qmunity_speed_reports(wa_from);
CREATE INDEX IF NOT EXISTS idx_qmunity_speed_reports_created_at
  ON qmunity_speed_reports(created_at DESC);

-- ===========================================
-- TABLE 4: qmunity_issues
-- Stores community issue/comment reports
-- ===========================================
CREATE TABLE IF NOT EXISTS qmunity_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES qmunity_locations(id) ON DELETE CASCADE,
  wa_from TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qmunity_issues_location_created
  ON qmunity_issues(location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qmunity_issues_wa_from
  ON qmunity_issues(wa_from);
CREATE INDEX IF NOT EXISTS idx_qmunity_issues_created_at
  ON qmunity_issues(created_at DESC);

-- ===========================================
-- SEED DATA: Default location for prototype
-- ===========================================
INSERT INTO qmunity_locations (slug, name, max_capacity, is_active)
VALUES ('home-affairs', 'Home Affairs (Prototype)', 25, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  max_capacity = EXCLUDED.max_capacity,
  is_active = EXCLUDED.is_active;

-- ===========================================
-- ROW LEVEL SECURITY (RLS)
-- Service role bypasses RLS, so minimal config needed
-- ===========================================
ALTER TABLE qmunity_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE qmunity_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE qmunity_speed_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE qmunity_issues ENABLE ROW LEVEL SECURITY;

-- Policies for service role (webhook and API endpoint)
DO $$
BEGIN
  -- qmunity_locations policies
  DROP POLICY IF EXISTS "Service role full access to qmunity_locations" ON qmunity_locations;
  CREATE POLICY "Service role full access to qmunity_locations"
  ON qmunity_locations FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

  -- qmunity_checkins policies
  DROP POLICY IF EXISTS "Service role full access to qmunity_checkins" ON qmunity_checkins;
  CREATE POLICY "Service role full access to qmunity_checkins"
  ON qmunity_checkins FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

  -- qmunity_speed_reports policies
  DROP POLICY IF EXISTS "Service role full access to qmunity_speed_reports" ON qmunity_speed_reports;
  CREATE POLICY "Service role full access to qmunity_speed_reports"
  ON qmunity_speed_reports FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

  -- qmunity_issues policies
  DROP POLICY IF EXISTS "Service role full access to qmunity_issues" ON qmunity_issues;
  CREATE POLICY "Service role full access to qmunity_issues"
  ON qmunity_issues FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

-- ===========================================
-- VERIFICATION QUERIES
-- ===========================================
-- Check tables were created
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'qmunity_%';

-- Check seed data
SELECT * FROM qmunity_locations WHERE slug = 'home-affairs';

-- Show indexes
SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename LIKE 'qmunity_%'
ORDER BY tablename, indexname;

-- ===========================================
-- SUCCESS! Qmunity tables are ready.
-- Next: Deploy webhook.js and qmunity.js
-- ===========================================
