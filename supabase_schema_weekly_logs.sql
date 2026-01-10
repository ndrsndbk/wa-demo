-- =====================================================
-- Supabase Schema for Weekly Reflection Log System
-- =====================================================

-- Table: log_sessions
-- Tracks the state of ongoing log sessions for each user
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

-- Index for fast lookups by phone number
CREATE INDEX IF NOT EXISTS idx_log_sessions_wa_from ON log_sessions(wa_from);

-- Unique constraint: one session per phone number
CREATE UNIQUE INDEX IF NOT EXISTS idx_log_sessions_wa_from_unique ON log_sessions(wa_from);

-- =====================================================

-- Table: weekly_reflection_logs
-- Stores the structured weekly reflection logs
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

-- Indices for common queries
CREATE INDEX IF NOT EXISTS idx_weekly_logs_wa_from ON weekly_reflection_logs(wa_from);
CREATE INDEX IF NOT EXISTS idx_weekly_logs_log_date ON weekly_reflection_logs(log_date DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_logs_week_number ON weekly_reflection_logs(week_number);
CREATE INDEX IF NOT EXISTS idx_weekly_logs_created_at ON weekly_reflection_logs(created_at DESC);

-- Composite index for user + date queries
CREATE INDEX IF NOT EXISTS idx_weekly_logs_wa_from_date ON weekly_reflection_logs(wa_from, log_date DESC);

-- GIN index for JSONB structured_json queries
CREATE INDEX IF NOT EXISTS idx_weekly_logs_structured_json ON weekly_reflection_logs USING GIN (structured_json);

-- =====================================================

-- Table: failed_log_inserts
-- Failsafe table to catch any logs that couldn't be inserted into weekly_reflection_logs
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

-- Index for retrieving unresolved failures
CREATE INDEX IF NOT EXISTS idx_failed_log_inserts_created_at ON failed_log_inserts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_failed_log_inserts_resolved ON failed_log_inserts(resolved_at) WHERE resolved_at IS NULL;

-- =====================================================
-- STORAGE BUCKET
-- =====================================================

-- You need to create the storage bucket manually in Supabase Dashboard or via SQL:
-- 1. Go to Supabase Dashboard > Storage
-- 2. Create a new bucket named: "weekly-logs"
-- 3. Set it as PUBLIC if you want public URLs, or PRIVATE if you want authenticated access
-- 4. Alternatively, run this (requires admin privileges):

-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('weekly-logs', 'weekly-logs', true)
-- ON CONFLICT (id) DO NOTHING;

-- Storage policies (adjust based on your security needs)
-- Example: Allow authenticated users to upload to their own folder

-- CREATE POLICY "Users can upload to their own folder"
-- ON storage.objects FOR INSERT
-- TO authenticated
-- WITH CHECK (bucket_id = 'weekly-logs' AND (storage.foldername(name))[1] = auth.uid()::text);

-- CREATE POLICY "Users can read their own files"
-- ON storage.objects FOR SELECT
-- TO authenticated
-- USING (bucket_id = 'weekly-logs' AND (storage.foldername(name))[1] = auth.uid()::text);

-- For service role (webhook), you typically don't need policies as service_role bypasses RLS

-- =====================================================
-- USEFUL QUERIES
-- =====================================================

-- Get all logs for a specific user
-- SELECT * FROM weekly_reflection_logs WHERE wa_from = '+1234567890' ORDER BY log_date DESC;

-- Get latest log for a user
-- SELECT * FROM weekly_reflection_logs WHERE wa_from = '+1234567890' ORDER BY created_at DESC LIMIT 1;

-- Get logs for a specific week
-- SELECT * FROM weekly_reflection_logs WHERE week_number = 5 AND EXTRACT(YEAR FROM log_date) = 2026;

-- Search within structured JSON
-- SELECT * FROM weekly_reflection_logs WHERE structured_json->>'wins' LIKE '%project%';

-- Get all unresolved failed inserts
-- SELECT * FROM failed_log_inserts WHERE resolved_at IS NULL ORDER BY created_at DESC;

-- Check current session status
-- SELECT * FROM log_sessions WHERE wa_from = '+1234567890';

-- =====================================================
-- MAINTENANCE
-- =====================================================

-- Optional: Clean up old idle sessions (run periodically)
-- DELETE FROM log_sessions WHERE status = 'idle' AND updated_at < now() - interval '7 days';

-- Optional: Archive old logs (if needed)
-- CREATE TABLE weekly_reflection_logs_archive (LIKE weekly_reflection_logs INCLUDING ALL);
-- INSERT INTO weekly_reflection_logs_archive SELECT * FROM weekly_reflection_logs WHERE log_date < '2025-01-01';
-- DELETE FROM weekly_reflection_logs WHERE log_date < '2025-01-01';
