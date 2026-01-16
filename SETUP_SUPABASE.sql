-- =====================================================
-- COMPLETE SUPABASE SETUP FOR WEEKLY REFLECTION LOG SYSTEM
-- Copy and paste this entire file into Supabase SQL Editor
-- =====================================================

-- Step 1: Create log_sessions table
-- =====================================================
CREATE TABLE IF NOT EXISTS log_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_from TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  last_prompted_at TIMESTAMPTZ,
  current_week INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  context_json JSONB,

  CONSTRAINT log_sessions_status_check CHECK (status IN ('idle', 'awaiting_audio'))
);

CREATE INDEX IF NOT EXISTS idx_log_sessions_wa_from ON log_sessions(wa_from);
CREATE UNIQUE INDEX IF NOT EXISTS idx_log_sessions_wa_from_unique ON log_sessions(wa_from);

-- Step 2: Create weekly_reflection_logs table
-- =====================================================
CREATE TABLE IF NOT EXISTS weekly_reflection_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_from TEXT NOT NULL,
  log_date DATE NOT NULL,
  week_number INTEGER NOT NULL,
  transcript_text TEXT NOT NULL,
  audio_storage_path TEXT NOT NULL,
  audio_url TEXT,
  structured_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT weekly_reflection_logs_week_check CHECK (week_number >= 1 AND week_number <= 53)
);

CREATE INDEX IF NOT EXISTS idx_weekly_logs_wa_from ON weekly_reflection_logs(wa_from);
CREATE INDEX IF NOT EXISTS idx_weekly_logs_log_date ON weekly_reflection_logs(log_date DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_logs_week_number ON weekly_reflection_logs(week_number);
CREATE INDEX IF NOT EXISTS idx_weekly_logs_created_at ON weekly_reflection_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_logs_wa_from_date ON weekly_reflection_logs(wa_from, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_logs_structured_json ON weekly_reflection_logs USING GIN (structured_json);

-- Step 3: Create failed_log_inserts table (failsafe)
-- =====================================================
CREATE TABLE IF NOT EXISTS failed_log_inserts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_from TEXT NOT NULL,
  transcript_text TEXT NOT NULL,
  audio_storage_path TEXT,
  audio_url TEXT,
  structured_json JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_failed_log_inserts_created_at ON failed_log_inserts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_failed_log_inserts_resolved ON failed_log_inserts(resolved_at) WHERE resolved_at IS NULL;

-- Step 4: Enable Row Level Security (RLS) and create policies
-- =====================================================
-- Enable RLS on all tables
ALTER TABLE log_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_reflection_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE failed_log_inserts ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist, then recreate
DO $$
BEGIN
  -- Policies for log_sessions table
  DROP POLICY IF EXISTS "Service role full access to log_sessions" ON log_sessions;

  CREATE POLICY "Service role full access to log_sessions"
  ON log_sessions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

  -- Policies for weekly_reflection_logs table
  DROP POLICY IF EXISTS "Service role full access to weekly_reflection_logs" ON weekly_reflection_logs;
  DROP POLICY IF EXISTS "Anon can read weekly_reflection_logs" ON weekly_reflection_logs;

  -- Allow service role (webhook) to insert/update/delete logs
  CREATE POLICY "Service role full access to weekly_reflection_logs"
  ON weekly_reflection_logs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

  -- Allow anon role (dashboard) to read all logs
  CREATE POLICY "Anon can read weekly_reflection_logs"
  ON weekly_reflection_logs FOR SELECT
  TO anon
  USING (true);

  -- Policies for failed_log_inserts table
  DROP POLICY IF EXISTS "Service role full access to failed_log_inserts" ON failed_log_inserts;

  CREATE POLICY "Service role full access to failed_log_inserts"
  ON failed_log_inserts FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

EXCEPTION
  WHEN duplicate_object THEN
    NULL;  -- Ignore if policies already exist
END $$;

-- Step 5: Create storage bucket for audio files
-- =====================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'weekly-logs',
  'weekly-logs',
  true,  -- Set to true for public access, false for private
  52428800,  -- 50 MB limit
  ARRAY['audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Step 6: Set up storage policies (allows service role to upload)
-- =====================================================
-- Drop existing policies if they exist, then recreate
DO $$
BEGIN
  -- Drop policies if they exist
  DROP POLICY IF EXISTS "Service role can upload audio files" ON storage.objects;
  DROP POLICY IF EXISTS "Service role can read audio files" ON storage.objects;
  DROP POLICY IF EXISTS "Public can read audio files" ON storage.objects;

  -- Create new policies
  -- Allow service role to insert files (webhook uses service role key)
  CREATE POLICY "Service role can upload audio files"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'weekly-logs');

  -- Allow service role to read files
  CREATE POLICY "Service role can read audio files"
  ON storage.objects FOR SELECT
  TO service_role
  USING (bucket_id = 'weekly-logs');

  -- Allow public to read files if bucket is public
  CREATE POLICY "Public can read audio files"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'weekly-logs');

EXCEPTION
  WHEN duplicate_object THEN
    NULL;  -- Ignore if policies already exist
END $$;

-- Step 7: Verify setup with sample queries
-- =====================================================
-- Check if tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('log_sessions', 'weekly_reflection_logs', 'failed_log_inserts');

-- Check if bucket exists
SELECT * FROM storage.buckets WHERE id = 'weekly-logs';

-- Show all indexes
SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('log_sessions', 'weekly_reflection_logs', 'failed_log_inserts')
ORDER BY tablename, indexname;

-- =====================================================
-- SUCCESS! Your database is ready.
-- Next steps:
-- 1. Add OPENAI_API_KEY (or XAI_API_KEY for Grok) to your environment variables
-- 2. Deploy your webhook
-- 3. Test by sending "log" via WhatsApp
-- =====================================================


-- =====================================================
-- APPENDIX: QMUNITY QUEUE TABLES
-- Added: Community crowd-reporting for Home Affairs queues
-- Run supabase_schema_qmunity.sql for the full setup,
-- or use the simplified version below:
-- =====================================================

-- Qmunity Locations Table
CREATE TABLE IF NOT EXISTS qmunity_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  max_capacity INTEGER NOT NULL DEFAULT 25,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qmunity_locations_slug ON qmunity_locations(slug);

-- Qmunity Check-ins Table
CREATE TABLE IF NOT EXISTS qmunity_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES qmunity_locations(id) ON DELETE CASCADE,
  wa_from TEXT NOT NULL,
  queue_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT qmunity_checkins_queue_number_check CHECK (queue_number >= 1 AND queue_number <= 999)
);

CREATE INDEX IF NOT EXISTS idx_qmunity_checkins_location_created ON qmunity_checkins(location_id, created_at DESC);

-- Qmunity Speed Reports Table
CREATE TABLE IF NOT EXISTS qmunity_speed_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES qmunity_locations(id) ON DELETE CASCADE,
  wa_from TEXT NOT NULL,
  speed TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT qmunity_speed_reports_speed_check CHECK (speed IN ('QUICKLY', 'MODERATELY', 'SLOW'))
);

CREATE INDEX IF NOT EXISTS idx_qmunity_speed_reports_location_created ON qmunity_speed_reports(location_id, created_at DESC);

-- Qmunity Issues Table
CREATE TABLE IF NOT EXISTS qmunity_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES qmunity_locations(id) ON DELETE CASCADE,
  wa_from TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qmunity_issues_location_created ON qmunity_issues(location_id, created_at DESC);

-- Seed default location
INSERT INTO qmunity_locations (slug, name, max_capacity, is_active)
VALUES ('home-affairs', 'Home Affairs (Prototype)', 25, true)
ON CONFLICT (slug) DO NOTHING;

-- Enable RLS
ALTER TABLE qmunity_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE qmunity_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE qmunity_speed_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE qmunity_issues ENABLE ROW LEVEL SECURITY;

-- RLS Policies (service role bypasses these automatically)
DO $$
BEGIN
  DROP POLICY IF EXISTS "Service role full access to qmunity_locations" ON qmunity_locations;
  CREATE POLICY "Service role full access to qmunity_locations" ON qmunity_locations FOR ALL TO service_role USING (true) WITH CHECK (true);

  DROP POLICY IF EXISTS "Service role full access to qmunity_checkins" ON qmunity_checkins;
  CREATE POLICY "Service role full access to qmunity_checkins" ON qmunity_checkins FOR ALL TO service_role USING (true) WITH CHECK (true);

  DROP POLICY IF EXISTS "Service role full access to qmunity_speed_reports" ON qmunity_speed_reports;
  CREATE POLICY "Service role full access to qmunity_speed_reports" ON qmunity_speed_reports FOR ALL TO service_role USING (true) WITH CHECK (true);

  DROP POLICY IF EXISTS "Service role full access to qmunity_issues" ON qmunity_issues;
  CREATE POLICY "Service role full access to qmunity_issues" ON qmunity_issues FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Verify Qmunity tables
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'qmunity_%';

-- =====================================================
-- END OF QMUNITY APPENDIX
-- =====================================================
