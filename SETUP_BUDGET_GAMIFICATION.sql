-- =====================================================
-- BUDGET GAMIFICATION: DATABASE MIGRATION
-- Adherence, Reminders & Gamification System
-- Run this in Supabase SQL Editor AFTER SETUP_BUDGET_TRACKER.sql
-- =====================================================

-- Step 1: Add new columns to budget_profiles
-- =====================================================
ALTER TABLE budget_profiles
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  ADD COLUMN IF NOT EXISTS reminders_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_user_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_expense_log_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_log_date DATE,
  ADD COLUMN IF NOT EXISTS current_streak INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longest_streak INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS on_track_streak INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_on_track_date DATE,
  ADD COLUMN IF NOT EXISTS last_micro_reward_date DATE;

-- Step 2: Create budget_badges table
-- =====================================================
CREATE TABLE IF NOT EXISTS budget_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_from TEXT NOT NULL,
  badge_code TEXT NOT NULL,
  earned_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT budget_badges_unique UNIQUE (wa_from, badge_code)
);

CREATE INDEX IF NOT EXISTS idx_budget_badges_wa_from ON budget_badges(wa_from);

-- Step 3: Enable RLS + policies
-- =====================================================
ALTER TABLE budget_badges ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Service role full access to budget_badges" ON budget_badges;
  CREATE POLICY "Service role full access to budget_badges"
  ON budget_badges FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

-- Step 4: Verify
-- =====================================================
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'budget_profiles'
  AND column_name IN (
    'timezone', 'reminders_enabled', 'last_user_message_at',
    'last_expense_log_at', 'last_log_date', 'current_streak',
    'longest_streak', 'on_track_streak', 'last_on_track_date',
    'last_micro_reward_date'
  )
ORDER BY ordinal_position;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'budget_badges';

-- =====================================================
-- SUCCESS! Gamification columns and badges table ready.
-- =====================================================
