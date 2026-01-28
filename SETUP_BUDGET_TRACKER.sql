-- =====================================================
-- BUDGET TRACKER: DATABASE SETUP
-- Dual-Mode WhatsApp Budget Tracker
-- Run this in Supabase SQL Editor
-- =====================================================

-- Step 1: Create budget_profiles table
-- Stores user profile with mode selection and budget parameters
-- =====================================================
CREATE TABLE IF NOT EXISTS budget_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_from TEXT NOT NULL,
  mode TEXT NOT NULL,
  -- Full mode fields
  total_budget_vnd BIGINT,
  fixed_costs_vnd BIGINT,
  savings_goal_vnd BIGINT,
  discretionary_budget_vnd BIGINT,
  -- Limit mode field
  available_budget_vnd BIGINT,
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT budget_profiles_mode_check CHECK (mode IN ('full', 'limit'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_profiles_wa_from ON budget_profiles(wa_from);
CREATE INDEX IF NOT EXISTS idx_budget_profiles_mode ON budget_profiles(mode);

-- Step 2: Create budget_categories table
-- Stores user-defined spending categories
-- =====================================================
CREATE TABLE IF NOT EXISTS budget_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_from TEXT NOT NULL,
  category_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_categories_wa_from ON budget_categories(wa_from);

-- Step 3: Create budget_expenses table
-- Stores individual expense entries
-- =====================================================
CREATE TABLE IF NOT EXISTS budget_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_from TEXT NOT NULL,
  amount_vnd BIGINT NOT NULL,
  category TEXT NOT NULL,
  note TEXT,
  expense_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT budget_expenses_amount_positive CHECK (amount_vnd > 0)
);

CREATE INDEX IF NOT EXISTS idx_budget_expenses_wa_from ON budget_expenses(wa_from);
CREATE INDEX IF NOT EXISTS idx_budget_expenses_date ON budget_expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_budget_expenses_wa_from_date ON budget_expenses(wa_from, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_budget_expenses_category ON budget_expenses(wa_from, category);

-- Step 4: Enable Row Level Security
-- =====================================================
ALTER TABLE budget_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_expenses ENABLE ROW LEVEL SECURITY;

-- Step 5: RLS Policies (service role bypasses automatically)
-- =====================================================
DO $$
BEGIN
  DROP POLICY IF EXISTS "Service role full access to budget_profiles" ON budget_profiles;
  CREATE POLICY "Service role full access to budget_profiles"
  ON budget_profiles FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

  DROP POLICY IF EXISTS "Service role full access to budget_categories" ON budget_categories;
  CREATE POLICY "Service role full access to budget_categories"
  ON budget_categories FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

  DROP POLICY IF EXISTS "Service role full access to budget_expenses" ON budget_expenses;
  CREATE POLICY "Service role full access to budget_expenses"
  ON budget_expenses FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

-- Step 6: Verify setup
-- =====================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('budget_profiles', 'budget_categories', 'budget_expenses');

-- =====================================================
-- SUCCESS! Budget tracker tables are ready.
-- =====================================================
