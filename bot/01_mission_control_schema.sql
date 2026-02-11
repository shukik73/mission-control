-- ============================================
-- MISSION CONTROL DATABASE SCHEMA
-- For: Techy Miramar AI Agent Squad
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- PRIORITY ENUM (ensures correct sort order)
-- ============================================
CREATE TYPE mission_priority AS ENUM ('urgent', 'high', 'normal', 'low');

-- ============================================
-- AGENTS TABLE
-- ============================================
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT CHECK (status IN ('active','idle','error','paused','offline')) DEFAULT 'idle',
  model TEXT,
  cost_per_1k_tokens DECIMAL(10,4),
  last_heartbeat TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

INSERT INTO agents (id, name, role, model) VALUES
('scout', 'Scout', 'eBay/Amazon Sourcing Specialist', 'llama-3.1'),
('jay', 'Jay', 'Squad Lead & Execution', 'claude-sonnet-4'),
('kai', 'Kai', 'Assistant', 'claude-sonnet-4'),
('iron-sec', 'Iron Secretary Op', 'Call Analysis & Customer Management', 'claude-sonnet-4'),
('reviewguard', 'ReviewGuard Mon', 'Google Reviews Monitoring', 'claude-haiku-4'),
('emilio', 'Emilio Outbound', 'Cold Email Campaigns', 'claude-haiku-4'),
('hamoriko', 'Hamoriko Producer', 'YouTube Content Generation', 'claude-sonnet-4'),
('shuki', 'Shuki', 'Human Operator & Final Approver', NULL);

-- ============================================
-- MISSIONS TABLE (Task Queue)
-- ============================================
CREATE TABLE missions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  status TEXT CHECK (status IN ('inbox','assigned','active','review','needs_shuki','done','rejected')) DEFAULT 'inbox',
  priority mission_priority DEFAULT 'normal',
  title TEXT NOT NULL,
  description TEXT,
  assigned_to TEXT REFERENCES agents(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deadline TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_missions_status ON missions(status);
CREATE INDEX idx_missions_agent_id ON missions(agent_id);
CREATE INDEX idx_missions_assigned_to ON missions(assigned_to);
CREATE INDEX idx_missions_priority ON missions(priority);
CREATE INDEX idx_missions_deadline ON missions(deadline) WHERE deadline IS NOT NULL;

-- ============================================
-- AGENT ACTIVITY LOG
-- ============================================
CREATE TABLE agent_activity (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  activity_type TEXT NOT NULL,
  mission_id UUID REFERENCES missions(id),
  message TEXT NOT NULL,
  severity TEXT CHECK (severity IN ('info','warning','error','critical')) DEFAULT 'info',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_agent_activity_agent_id ON agent_activity(agent_id);
CREATE INDEX idx_agent_activity_created_at ON agent_activity(created_at DESC);

-- ============================================
-- FINANCIAL TRACKING
-- ============================================
CREATE TABLE financial_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  revenue DECIMAL(10,2) DEFAULT 0,
  api_calls INT DEFAULT 0,
  tokens_used BIGINT DEFAULT 0,
  cost DECIMAL(10,2) DEFAULT 0,
  roi_percent DECIMAL(5,2),
  net_profit DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date, agent_id)
);

-- ============================================
-- SCOUT DEALS TABLE
-- ============================================
CREATE TABLE scout_deals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mission_id UUID REFERENCES missions(id),
  platform TEXT NOT NULL,
  item_url TEXT NOT NULL,
  title TEXT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  shipping_cost DECIMAL(10,2) DEFAULT 0,
  total_cost DECIMAL(10,2) GENERATED ALWAYS AS (price + shipping_cost) STORED,
  estimated_value DECIMAL(10,2) NOT NULL,
  roi_percent DECIMAL(5,2) NOT NULL,
  profit DECIMAL(10,2) GENERATED ALWAYS AS (estimated_value - (price + shipping_cost)) STORED,
  item_type TEXT,
  model TEXT,
  condition TEXT,
  location TEXT,
  seller_name TEXT,
  seller_rating DECIMAL(5,2),
  seller_feedback_count INT,
  auction_ends_at TIMESTAMPTZ,
  is_local_pickup BOOLEAN DEFAULT false,
  status TEXT CHECK (status IN ('pending','approved','rejected','purchased')) DEFAULT 'pending',
  decision_made_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scout_deals_status ON scout_deals(status);
CREATE INDEX idx_scout_deals_roi ON scout_deals(roi_percent DESC);

-- ============================================
-- PRICE BENCHMARKS
-- ============================================
CREATE TABLE price_benchmarks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  model TEXT NOT NULL,
  item_type TEXT NOT NULL,
  avg_sold_price DECIMAL(10,2) NOT NULL,
  min_sold_price DECIMAL(10,2),
  max_sold_price DECIMAL(10,2),
  sample_size INT NOT NULL,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(model, item_type)
);

-- ============================================
-- TELEGRAM NOTIFICATIONS QUEUE
-- ============================================
CREATE TABLE telegram_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mission_id UUID REFERENCES missions(id),
  message TEXT NOT NULL,
  priority mission_priority DEFAULT 'normal',
  actions JSONB,
  status TEXT CHECK (status IN ('pending','sent','failed')) DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  telegram_message_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- AUTO-UPDATE TRIGGERS
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_missions_updated_at BEFORE UPDATE ON missions
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_financial_tracking_updated_at BEFORE UPDATE ON financial_tracking
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scout_deals_updated_at BEFORE UPDATE ON scout_deals
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- DASHBOARD VIEWS
-- ============================================
CREATE OR REPLACE VIEW mission_control_summary AS
SELECT
  status,
  COUNT(*) as count,
  COUNT(*) FILTER (WHERE priority = 'urgent') as urgent_count
FROM missions
WHERE status != 'done'
GROUP BY status;

CREATE OR REPLACE VIEW agent_performance_today AS
SELECT
  a.id,
  a.name,
  a.status,
  COUNT(m.id) FILTER (WHERE m.status = 'done' AND m.completed_at::date = CURRENT_DATE) as tasks_completed_today,
  COUNT(m.id) FILTER (WHERE m.status != 'done') as tasks_pending,
  COALESCE(f.revenue, 0) as revenue_today,
  COALESCE(f.cost, 0) as cost_today
FROM agents a
LEFT JOIN missions m ON a.id = m.agent_id
LEFT JOIN financial_tracking f ON a.id = f.agent_id AND f.date = CURRENT_DATE
GROUP BY a.id, a.name, a.status, f.revenue, f.cost;
