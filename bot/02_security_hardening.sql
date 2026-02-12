-- ============================================
-- SECURITY HARDENING MIGRATION
-- Fixes: Missing RLS, missing unique constraints,
--        missing audit log, missing deal approval tracking
-- ============================================

-- ============================================
-- 1. ENABLE ROW LEVEL SECURITY ON ALL CORE TABLES
-- ============================================
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_trends ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_notifications ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 2. SERVICE_ROLE POLICIES (full access for backend/agents)
-- ============================================
CREATE POLICY "service_role_full_access_agents" ON agents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access_missions" ON missions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access_agent_activity" ON agent_activity
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access_financial_tracking" ON financial_tracking
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access_scout_deals" ON scout_deals
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access_scout_trends" ON scout_trends
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access_price_benchmarks" ON price_benchmarks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access_leads" ON leads
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access_telegram_notifications" ON telegram_notifications
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================
-- 3. AUTHENTICATED USER POLICIES (dashboard read access)
-- ============================================
CREATE POLICY "authenticated_read_agents" ON agents
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_read_missions" ON missions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_read_scout_deals" ON scout_deals
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_read_agent_activity" ON agent_activity
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_read_financial_tracking" ON financial_tracking
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_read_leads" ON leads
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_read_price_benchmarks" ON price_benchmarks
  FOR SELECT TO authenticated USING (true);

-- Authenticated users can update scout_deals status (approve/reject from dashboard)
CREATE POLICY "authenticated_update_scout_deals" ON scout_deals
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (status IN ('approved', 'rejected'));

-- Authenticated users can update mission status
CREATE POLICY "authenticated_update_missions" ON missions
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (status IN ('done', 'rejected'));

-- ============================================
-- 4. ANON ROLE — DENY ALL (implicit, no policies = no access)
-- ============================================
-- No policies for anon role means RLS denies everything.
-- This blocks the dashboard anon key from any direct DB access.

-- ============================================
-- 5. UNIQUE CONSTRAINT ON scout_deals.item_url (prevent duplicates)
-- ============================================
-- Remove any existing duplicates first (keep the newest)
DELETE FROM scout_deals a
  USING scout_deals b
  WHERE a.item_url = b.item_url
    AND a.created_at < b.created_at;

ALTER TABLE scout_deals ADD CONSTRAINT unique_scout_deal_item_url UNIQUE (item_url);

-- ============================================
-- 6. DEAL APPROVAL AUDIT LOG TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS deal_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID NOT NULL REFERENCES scout_deals(id),
  mission_id UUID REFERENCES missions(id),
  action TEXT NOT NULL CHECK (action IN ('approved', 'rejected')),
  source TEXT NOT NULL CHECK (source IN ('dashboard', 'telegram', 'auto')),
  reason TEXT,
  performed_by TEXT, -- 'shuki', 'jay', or user email
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_deal_audit_log_deal_id ON deal_audit_log(deal_id);
CREATE INDEX idx_deal_audit_log_created_at ON deal_audit_log(created_at DESC);

ALTER TABLE deal_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_deal_audit_log" ON deal_audit_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_deal_audit_log" ON deal_audit_log
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_insert_deal_audit_log" ON deal_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);
