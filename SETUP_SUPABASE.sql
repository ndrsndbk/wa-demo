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

-- Step 4: Create storage bucket for audio files
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

-- Step 5: Set up storage policies (allows service role to upload)
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

-- Step 6: Verify setup with sample queries
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
