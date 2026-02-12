# Emilio Cold Outreach Pipeline — Integration Design

> Midas finds leads, Pluto scores them, Emilio writes emails. n8n does the work, Mission Control tracks it.

---

## ARCHITECTURE

```
                     n8n Workflow (KEEP AS-IS)
                    ┌─────────────────────────────┐
  Cron (4h) ───────►│ Midas → Pluto → Emilio      │
  or Manual ────────►│ (Apify)  (GPT)   (Claude)   │
                    │          ↓                    │
                    │    Google Sheets (output)     │
                    └──────────────┬────────────────┘
                                   │ webhook callback
                                   ▼
                    ┌─────────────────────────────┐
                    │  api/cron/emilio.ts          │
                    │  (Vercel Serverless)         │
                    │                             │
                    │  1. Read Sheets results      │
                    │  2. Upsert → leads table     │
                    │  3. Create missions          │
                    │  4. Alert Jay via Telegram   │
                    │  5. Log agent_activity       │
                    └─────────────────────────────┘
```

**Key principle:** Don't rewrite n8n. Wrap it.

---

## LEADS TABLE SCHEMA

Applied to Supabase `iron-secretary`:

```sql
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID REFERENCES missions(id),

  -- Midas data (from Google Places via n8n)
  business_name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  website TEXT,
  owner_name TEXT,
  google_rating DECIMAL(3,2),
  google_review_count INTEGER,
  google_place_id TEXT UNIQUE,

  -- Pluto data (pain analysis via n8n)
  pain_score INTEGER CHECK (pain_score BETWEEN 1 AND 10),
  pain_hook TEXT,
  pain_summary TEXT,

  -- Emilio data (email drafts via n8n)
  email_subject TEXT,
  email_body TEXT,

  -- Pipeline tracking
  status TEXT DEFAULT 'discovered' CHECK (status IN (
    'discovered',     -- Midas found the business
    'researched',     -- Pluto analyzed reviews
    'email_drafted',  -- Emilio wrote the email
    'email_sent',     -- Email was sent (future)
    'replied',        -- Lead replied (manual mark)
    'qualified',      -- Lead is a real opportunity
    'disqualified'    -- Dead lead
  )),
  search_query TEXT,              -- "Phone Repair Miami FL"
  search_mode TEXT CHECK (search_mode IN ('cron', 'manual')),

  -- Timestamps
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  researched_at TIMESTAMPTZ,
  email_drafted_at TIMESTAMPTZ,
  email_sent_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Column Mapping from Google Sheets

| Sheets Column | leads Column | Filled By |
|---|---|---|
| Business | `business_name` | Midas |
| Address | `address` | Midas |
| Phone | `phone` | Midas |
| Website | `website` | Midas |
| Rating | `google_rating` | Midas |
| ReviewCount | `google_review_count` | Midas |
| Owner | `owner_name` | Midas |
| Pain_Score | `pain_score` | Pluto |
| Hook | `pain_hook` | Pluto |
| Summary | `pain_summary` | Pluto |
| Subject | `email_subject` | Emilio |
| Body | `email_body` | Emilio |
| Status | `status` | Pipeline |

---

## TRIGGER MODES

### 1. Cron Mode (every 4 hours)
- Default search: "Phone Repair Miami FL"
- n8n webhook fires automatically
- Wrapper reads results from Sheets → Supabase

### 2. Manual Mode
- Shuki messages: "Wake Emilio for laptop repair in Orlando"
- Wrapper triggers n8n webhook with custom query
- Same pipeline, different search_query

---

## AGENT ROLES

### Midas (id: `midas` — maps to n8n Apify node)
- **Input:** Search query (e.g., "Phone Repair Miami FL")
- **Action:** Apify scrapes Google Places
- **Output:** Business listings → Google Sheets → `leads` table (status: `discovered`)

### Pluto (id: `pluto` — maps to n8n GPT-4o node)
- **Input:** Google Reviews for each lead
- **Action:** GPT-4o analyzes reviews, scores pain 1-10, identifies hooks
- **Output:** Pain scores → Google Sheets → `leads` table (status: `researched`)

### Emilio (id: `emilio` → maps to n8n Claude node)
- **Input:** Lead + pain analysis
- **Action:** Claude writes personalized cold email
- **Output:** Subject + Body → Google Sheets → `leads` table (status: `email_drafted`)

---

## CRON JOB: `api/cron/emilio.ts`

Runs every 4 hours. Steps:

```
1. Trigger n8n webhook (POST with search_query)
2. Wait for n8n to complete (poll or callback)
3. Read Google Sheets results (Sheets API)
4. For each row:
   a. UPSERT into leads (match on google_place_id)
   b. Create mission (agent_id: 'emilio', status: 'needs_shuki')
   c. Update lead status based on which columns are filled
5. Send Telegram summary to Jay
6. Log to agent_activity
7. Update agent heartbeat
```

### Status Logic
```
If only Midas columns filled     → status = 'discovered'
If Pain_Score present             → status = 'researched'
If Subject + Body present         → status = 'email_drafted'
```

---

## ENVIRONMENT VARIABLES NEEDED

```env
# Already set
SUPABASE_URL=https://djusjenyxujukdydhajp.supabase.co
SUPABASE_SERVICE_KEY=your_service_key

# New — for Emilio pipeline
N8N_WEBHOOK_URL=your_n8n_webhook_trigger_url
GOOGLE_SHEETS_ID=your_sheets_id
GOOGLE_SERVICE_ACCOUNT_KEY=your_google_service_account_json
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
```

---

## DECISIONS LOG

| Decision | Choice | Reason |
|---|---|---|
| Lead storage | Both (Sheets + Supabase) | n8n writes to Sheets, wrapper syncs to Supabase |
| Trigger | 4h cron + manual | Cron for baseline, manual for targeted pushes |
| Search scope | Parameterized + default | Default "Phone Repair Miami FL", manual accepts any |
| Email sending | Defer (draft only) | Need domain warm-up before cold sending |
| Reply tracking | Manual for now | Jay marks replied in Mission Control |
| n8n workflow | Keep as-is | Working, don't touch |

---

## PIPELINE STATES

```
discovered → researched → email_drafted → email_sent → replied → qualified
                                                     ↘ disqualified
```

- **discovered:** Midas found it on Google Places
- **researched:** Pluto scored pain 1-10
- **email_drafted:** Emilio wrote the email
- **email_sent:** Email was delivered (future — SendGrid)
- **replied:** Lead responded (Jay marks manually)
- **qualified:** Real opportunity (becomes a deal)
- **disqualified:** Dead lead (bad contact, not interested, etc.)

---

## WHAT'S NOT CHANGING

- n8n workflow stays exactly as-is
- Google Sheets stays as the n8n output target
- Apify stays as the scraper
- GPT-4o stays as the pain analyzer
- Claude stays as the email writer
- 4-hour schedule stays

## WHAT'S NEW

- `leads` table in Supabase (visibility in Mission Control)
- `api/cron/emilio.ts` Vercel function (sync wrapper)
- Telegram alerts when new leads are processed
- `agent_activity` logging for Midas/Pluto/Emilio
- Manual trigger support ("Wake Emilio for Orlando")
- Midas/Pluto need to be added to agents table (currently not there)

---

## NEXT STEPS

1. Add Midas + Pluto to `agents` table in Supabase
2. Get n8n webhook URL from Shuki
3. Get Google Sheets ID from Shuki
4. Build `api/cron/emilio.ts`
5. Set Vercel env vars
6. Test with manual trigger first
7. Enable 4-hour cron
