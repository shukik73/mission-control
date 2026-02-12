-- ============================================
-- REVENUE TRACKING MIGRATION
-- Adds closed-loop tracking: purchase → sale → actual profit
-- Fixes: F1 from Full Spectrum Audit (no closed-loop revenue tracking)
-- ============================================

-- ============================================
-- 1. ADD PURCHASE & SALE TRACKING TO scout_deals
-- ============================================
ALTER TABLE scout_deals
  ADD COLUMN IF NOT EXISTS purchased_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_purchase_price DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_sale_price DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS actual_platform_fees DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS actual_profit DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Index for revenue reporting
CREATE INDEX IF NOT EXISTS idx_scout_deals_purchased_at
  ON scout_deals(purchased_at DESC)
  WHERE purchased_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scout_deals_sold_at
  ON scout_deals(sold_at DESC)
  WHERE sold_at IS NOT NULL;

-- ============================================
-- 2. REVENUE RECONCILIATION VIEW
-- Shows actual vs estimated performance
-- ============================================
CREATE OR REPLACE VIEW revenue_reconciliation AS
SELECT
  id,
  title,
  platform,
  -- Estimated (at time of sourcing)
  price AS estimated_buy_price,
  shipping_cost,
  total_cost AS estimated_total_cost,
  estimated_value,
  roi_percent AS estimated_roi,
  profit AS estimated_profit,
  -- Actual (after purchase & sale)
  actual_purchase_price,
  actual_sale_price,
  actual_platform_fees,
  actual_profit,
  -- Accuracy metrics
  CASE
    WHEN actual_sale_price IS NOT NULL AND estimated_value > 0
    THEN ROUND(((actual_sale_price - estimated_value) / estimated_value * 100)::numeric, 1)
    ELSE NULL
  END AS price_accuracy_pct,
  CASE
    WHEN actual_profit IS NOT NULL AND profit > 0
    THEN ROUND(((actual_profit - profit) / profit * 100)::numeric, 1)
    ELSE NULL
  END AS profit_accuracy_pct,
  -- Status
  status,
  created_at,
  purchased_at,
  sold_at
FROM scout_deals
WHERE status IN ('approved', 'purchased')
ORDER BY created_at DESC;

-- ============================================
-- 3. DAILY REVENUE SUMMARY VIEW
-- ============================================
CREATE OR REPLACE VIEW daily_revenue_summary AS
SELECT
  sold_at::date AS sale_date,
  COUNT(*) AS items_sold,
  SUM(actual_sale_price) AS gross_revenue,
  SUM(actual_platform_fees) AS total_fees,
  SUM(actual_profit) AS net_profit,
  AVG(actual_profit) AS avg_profit_per_item,
  SUM(actual_purchase_price) AS total_investment
FROM scout_deals
WHERE sold_at IS NOT NULL
  AND actual_profit IS NOT NULL
GROUP BY sold_at::date
ORDER BY sale_date DESC;

-- ============================================
-- 4. EXPAND scout_deals STATUS TO INCLUDE 'sold'
-- ============================================
ALTER TABLE scout_deals
  DROP CONSTRAINT IF EXISTS scout_deals_status_check;

ALTER TABLE scout_deals
  ADD CONSTRAINT scout_deals_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'purchased', 'sold'));

-- ============================================
-- 5. RLS POLICY FOR NEW VIEW ACCESS
-- (Views inherit base table RLS, but explicit for clarity)
-- ============================================

-- Authenticated users can update purchased/sold fields on approved deals
-- (This supplements the existing authenticated_update_scout_deals policy)
