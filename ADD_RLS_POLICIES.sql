-- =====================================================
-- ADD RLS POLICIES TO FIX DASHBOARD ACCESS
-- Run this in Supabase SQL Editor to allow the dashboard to read logs
-- =====================================================

-- Enable Row Level Security (RLS) on all tables
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

-- Verify policies were created
SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE tablename IN ('log_sessions', 'weekly_reflection_logs', 'failed_log_inserts')
ORDER BY tablename, policyname;

-- =====================================================
-- SUCCESS! Your dashboard should now be able to read logs.
-- Refresh your dashboard at: https://ndrsndbk.github.io/TPC_OS/
-- =====================================================
