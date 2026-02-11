-- ============================================
-- TECHY MIRAMAR — SOCIAL MEDIA AGENT SCHEMA
-- Pixel (Creative) + Buzz (Social Media)
-- Depends on: 01_mission_control_schema.sql
-- ============================================

-- ============================================
-- REGISTER AGENTS in Mission Control
-- ============================================
INSERT INTO agents (id, name, role, model) VALUES
  ('pixel', 'Pixel', 'Creative Asset Production', 'claude-sonnet-4'),
  ('buzz', 'Buzz', 'Social Media Management', 'claude-sonnet-4')  -- Sonnet 4 (not 4.5) — good creative writing, lower cost
ON CONFLICT (id) DO NOTHING;


-- ============================================
-- PIXEL MISSIONS (Creative Pipeline)
-- ============================================
CREATE TABLE pixel_missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Mission Control integration
  mission_id UUID REFERENCES missions(id),  -- Links to central Mission Control queue

  -- Source & Context
  source TEXT NOT NULL CHECK (source IN ('manual', 'repair_complete', 'scout_deal', 'scheduled', 'review_trigger', 'iron_sec_faq')),
  business TEXT NOT NULL DEFAULT 'techy_miramar',
  content_type TEXT CHECK (content_type IN ('before_after', 'bts', 'testimonial', 'educational', 'promo', 'parts_haul', 'store_showcase')),
  description TEXT,  -- Brief description of the content

  -- Raw Input
  raw_assets JSONB DEFAULT '[]',  -- [{url, type: 'image'|'video', filename}]
  source_reference UUID,  -- FK to scout_missions, repair_jobs, reviews, etc.

  -- Creative Output
  enhanced_assets JSONB DEFAULT '[]',  -- [{url, type, platform, dimensions}]
  platform_formats JSONB DEFAULT '{}',  -- {ig_feed: url, ig_reel: url, fb_feed: url, tiktok: url}
  caption_variants TEXT[] DEFAULT '{}',  -- 3 caption variants
  hashtags JSONB DEFAULT '{}',  -- {brand: [], service: [], location: [], trending: []}

  -- Approval
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'needs_approval', 'approved', 'rejected', 'revision')),
  shuki_notes TEXT,
  approved_caption INT,  -- Which caption variant was approved (1, 2, or 3)

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,

  -- Telegram message tracking
  approval_message_id BIGINT  -- Telegram message ID in #approvals channel
);

CREATE INDEX idx_pixel_missions_status ON pixel_missions(status);
CREATE INDEX idx_pixel_missions_business ON pixel_missions(business);
CREATE INDEX idx_pixel_missions_created ON pixel_missions(created_at DESC);
CREATE INDEX idx_pixel_missions_mission ON pixel_missions(mission_id);


-- ============================================
-- BUZZ MISSIONS (Social Media Posting)
-- ============================================
CREATE TABLE buzz_missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Mission Control integration
  mission_id UUID REFERENCES missions(id),  -- Links to central Mission Control queue

  -- Link to Creative
  content_id UUID NOT NULL REFERENCES pixel_missions(id),
  business TEXT NOT NULL DEFAULT 'techy_miramar',

  -- Platform-Specific Copy
  platforms TEXT[] NOT NULL DEFAULT '{}',  -- ['instagram', 'tiktok', 'facebook']

  ig_caption TEXT,
  ig_hashtags TEXT[] DEFAULT '{}',
  ig_format TEXT CHECK (ig_format IN ('feed', 'reel', 'carousel', 'story')),

  fb_caption TEXT,
  fb_hashtags TEXT[] DEFAULT '{}',
  fb_format TEXT CHECK (fb_format IN ('post', 'story', 'reel')),

  tiktok_caption TEXT,
  tiktok_hashtags TEXT[] DEFAULT '{}',
  tiktok_sound TEXT,  -- Suggested trending sound

  -- Scheduling
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,

  -- Post IDs (after publishing)
  post_ids JSONB DEFAULT '{}',  -- {instagram: 'id', facebook: 'id', tiktok: 'id'}

  -- Approval
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'writing', 'needs_approval', 'approved',
    'scheduled', 'published', 'analyzing', 'complete',
    'ready_for_manual_post'
  )),
  shuki_notes TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Telegram message tracking
  approval_message_id BIGINT
);

CREATE INDEX idx_buzz_missions_status ON buzz_missions(status);
CREATE INDEX idx_buzz_missions_content ON buzz_missions(content_id);
CREATE INDEX idx_buzz_missions_scheduled ON buzz_missions(scheduled_at);
CREATE INDEX idx_buzz_missions_business ON buzz_missions(business);
CREATE INDEX idx_buzz_missions_mission ON buzz_missions(mission_id);


-- ============================================
-- SOCIAL ANALYTICS (Per-Post Metrics)
-- ============================================
CREATE TABLE social_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Links
  buzz_mission_id UUID NOT NULL REFERENCES buzz_missions(id),
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'facebook')),
  post_id TEXT,  -- Platform-specific post ID

  -- One analytics row per platform per buzz mission
  UNIQUE(buzz_mission_id, platform),

  -- Engagement Metrics
  likes INT DEFAULT 0,
  comments INT DEFAULT 0,
  shares INT DEFAULT 0,
  saves INT DEFAULT 0,  -- Instagram saves
  reach INT DEFAULT 0,
  impressions INT DEFAULT 0,
  video_views INT DEFAULT 0,  -- For Reels/TikTok

  -- Calculated
  engagement_rate DECIMAL(5,2),  -- (likes + comments + shares + saves) / reach * 100

  -- Profile Impact
  profile_visits INT DEFAULT 0,
  link_clicks INT DEFAULT 0,
  follower_delta INT DEFAULT 0,  -- Followers gained from this post

  -- Audience
  audience_demographics JSONB,  -- {age_ranges: {}, genders: {}, locations: {}}

  -- Tracking
  check_count INT DEFAULT 0,  -- How many times analytics were pulled
  first_check_at TIMESTAMPTZ,  -- Usually 48 hours after publish
  last_check_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_social_analytics_mission ON social_analytics(buzz_mission_id);
CREATE INDEX idx_social_analytics_platform ON social_analytics(platform);


-- ============================================
-- CONTENT PERFORMANCE INSIGHTS (Weekly/Monthly)
-- ============================================
CREATE TABLE content_performance_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Period
  period TEXT NOT NULL CHECK (period IN ('weekly', 'monthly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  business TEXT NOT NULL DEFAULT 'techy_miramar',

  -- Per-Platform Breakdown
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'facebook', 'all')),

  -- One insight row per business+platform+period+start
  UNIQUE(business, platform, period, period_start),

  -- Summary Metrics
  total_posts INT DEFAULT 0,
  total_reach INT DEFAULT 0,
  total_impressions INT DEFAULT 0,
  total_engagement INT DEFAULT 0,
  avg_engagement_rate DECIMAL(5,2),
  follower_count INT,  -- Snapshot at period end
  follower_growth INT DEFAULT 0,

  -- Best Performers
  best_content_type TEXT,  -- Which content_type performed best
  best_posting_time TIME,
  best_post_id UUID REFERENCES buzz_missions(id),
  worst_post_id UUID REFERENCES buzz_missions(id),

  -- Detailed Insights
  insights JSONB DEFAULT '{}',
  -- Structure: {
  --   by_content_type: {before_after: {avg_engagement: 5.2, count: 4}, ...},
  --   by_day_of_week: {monday: {avg_engagement: 3.1}, ...},
  --   by_time_of_day: {morning: {avg_reach: 500}, ...},
  --   top_hashtags: [{tag: '#iPhoneRepair', avg_reach: 800}, ...],
  --   content_velocity_avg_hours: 18  -- raw to published time
  -- }

  -- Recommendations
  recommendations TEXT[],  -- Actionable items
  pixel_direction TEXT,  -- Creative direction feedback for Pixel

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_insights_period ON content_performance_insights(period_start, period_end);
CREATE INDEX idx_insights_platform ON content_performance_insights(platform);


-- ============================================
-- CONTENT CALENDAR (Planning)
-- ============================================
CREATE TABLE content_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  business TEXT NOT NULL DEFAULT 'techy_miramar',
  planned_date DATE NOT NULL,
  day_of_week TEXT NOT NULL CHECK (day_of_week IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
  content_type TEXT NOT NULL,
  platforms TEXT[] DEFAULT '{}',
  description TEXT,

  -- Status
  pixel_mission_id UUID REFERENCES pixel_missions(id),
  buzz_mission_id UUID REFERENCES buzz_missions(id),
  status TEXT DEFAULT 'planned' CHECK (status IN ('planned', 'in_creative', 'in_social', 'published', 'skipped')),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_calendar_date ON content_calendar(planned_date);


-- ============================================
-- SOCIAL ACCOUNTS (Platform Config)
-- ============================================
-- NOTE: Access tokens must NEVER be stored as plaintext.
-- Use Supabase Vault (pgsodium) to store tokens securely:
--   SELECT vault.create_secret('token_value', 'ig_access_token', 'Instagram token for Techy Miramar');
-- Then store the returned UUID in access_token_vault_id.
-- To retrieve: SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = access_token_vault_id;

CREATE TABLE social_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  business TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'facebook', 'linkedin')),
  account_name TEXT NOT NULL,
  account_id TEXT,  -- Platform-specific account/page ID
  account_url TEXT,

  -- API Config — token stored in Supabase Vault, reference by UUID
  access_token_vault_id UUID,  -- References vault.secrets(id) — see NOTE above
  token_expires_at TIMESTAMPTZ,
  api_enabled BOOLEAN DEFAULT FALSE,

  -- Current Stats (updated periodically)
  follower_count INT DEFAULT 0,
  following_count INT DEFAULT 0,
  post_count INT DEFAULT 0,
  last_synced_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- One account per business+platform+name
  UNIQUE(business, platform, account_name)
);

-- Seed with known accounts
INSERT INTO social_accounts (business, platform, account_name, account_url, api_enabled) VALUES
  ('techy_miramar', 'facebook', 'TechyMiramar', 'https://www.facebook.com/TechyMiramar/', FALSE),
  ('techy_miramar', 'instagram', 'techy_company', 'https://www.instagram.com/techy_company/', FALSE);

-- Existing content library references
CREATE TABLE content_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business TEXT NOT NULL DEFAULT 'techy_miramar',
  drive_folder_id TEXT NOT NULL,
  description TEXT,
  content_type TEXT CHECK (content_type IN ('reels', 'repair_footage', 'photos', 'brand_assets', 'brochures')),
  used_assets JSONB DEFAULT '[]',  -- Track which files have been posted to avoid repeats
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO content_library (business, drive_folder_id, description, content_type) VALUES
  ('techy_miramar', '1yLD3ib0-Di-4lQGtmsmvLwM2oeJ0wFJ9', 'Reels / video content set 1', 'reels'),
  ('techy_miramar', '1v3R2eqYYU6GWtrHFBbsRXEdggma_wxwh', 'Reels / video content set 2', 'reels'),
  ('techy_miramar', '1T-vw8ipPax6YjME1UzUqJs6uo3M9n89J', 'Repair reels / footage set 1', 'repair_footage'),
  ('techy_miramar', '1N8vswoII1zu2g_yfGZvL7zHwcCT5bmeu', 'Repair reels / footage set 2', 'repair_footage'),
  ('techy_miramar', '10zPUdnAB1THOtxGoYnVCALA9Qh6kJLet', 'Brand assets - logos, brochures, banners', 'brand_assets');


-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Reuse update_updated_at_column() from 01_mission_control_schema.sql
-- (already created there — do NOT redefine)

CREATE TRIGGER pixel_missions_updated_at
  BEFORE UPDATE ON pixel_missions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER buzz_missions_updated_at
  BEFORE UPDATE ON buzz_missions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Calculate engagement rate
CREATE OR REPLACE FUNCTION calc_engagement_rate()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reach > 0 THEN
    NEW.engagement_rate = ROUND(
      ((NEW.likes + NEW.comments + NEW.shares + NEW.saves)::DECIMAL / NEW.reach) * 100, 2
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_calc_engagement
  BEFORE INSERT OR UPDATE ON social_analytics
  FOR EACH ROW EXECUTE FUNCTION calc_engagement_rate();


-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE pixel_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE buzz_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_performance_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_library ENABLE ROW LEVEL SECURITY;

-- service_role (agents & backend) — full access
CREATE POLICY "service_role_full_access_pixel" ON pixel_missions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_buzz" ON buzz_missions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_analytics" ON social_analytics FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_insights" ON content_performance_insights FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_calendar" ON content_calendar FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_accounts" ON social_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_library" ON content_library FOR ALL TO service_role USING (true) WITH CHECK (true);

-- authenticated (dashboard users) — read-only on safe tables
CREATE POLICY "authenticated_read_calendar" ON content_calendar FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read_insights" ON content_performance_insights FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read_library" ON content_library FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read_analytics" ON social_analytics FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read_pixel" ON pixel_missions FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read_buzz" ON buzz_missions FOR SELECT TO authenticated USING (true);

-- anon/public — no access (social_accounts contains sensitive token refs)
-- No policies = deny all for anon role (RLS enabled, no matching policy)
