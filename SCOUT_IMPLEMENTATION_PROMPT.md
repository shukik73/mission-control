# Scout Implementation Prompt for Claude Code

> Use this prompt with Claude Code to build Scout Agent ready for OpenClaw deployment.

---

## CONTEXT

Scout Baz is an autonomous eBay deal-finder for **Techy Miramar** (phone/laptop repair shop in Miramar, FL). It runs every 2 hours via OpenClaw cron, searches eBay for refurbished/used electronics, filters deals through "Ghost Protocol" (auto-passes low-quality deals), and inserts qualified deals into Supabase Mission Control.

Scout also has a **manual parts-search mode** — Shuki can trigger a one-off search for specific repair parts needed in the store (e.g., "iPhone 14 Pro Max screen", "MacBook A1708 keyboard").

- **System Prompt Reference:** `scout_system_prompt.md` (GitHub)
- **Schema Reference:** `bot/01_mission_control_schema.sql` (GitHub)
- **Deployment Model:** OpenClaw cron spawn (every 2 hours) + manual trigger via Telegram
- **Supabase Project:** `iron-secretary` (ref: `djusjenyxujukdydhajp`)

### Tech Stack
- eBay Browse API (production — **not** the deprecated Finding API)
- `@supabase/supabase-js` (Node.js client)
- Telegram Bot API (`node-telegram-bot-api`)
- Node.js 18+

---

## ⚠️ CRITICAL SCHEMA RULES — READ FIRST

These are hard constraints from the actual Supabase schema. Violating them will crash the agent.

### GENERATED Columns (NEVER INSERT)
```
scout_deals.total_cost  →  auto-calculated as (price + shipping_cost)
scout_deals.profit      →  auto-calculated as (estimated_value - total_cost)
```
If you include `total_cost` or `profit` in any INSERT, Postgres will throw an error.

### scout_deals.status CHECK Constraint
Valid values: `'pending'`, `'approved'`, `'rejected'`, `'purchased'`
- ❌ `'pending_approval'` — DOES NOT EXIST
- ❌ `'error'` — DOES NOT EXIST
- Always insert as `'pending'` — Shuki decides via dashboard

### scout_deals.item_url is NOT NULL
Every scout_deal MUST have an `item_url`. Missing it = insert failure.

### missions.status CHECK Constraint
Valid values: `'inbox'`, `'assigned'`, `'active'`, `'review'`, `'needs_shuki'`, `'done'`, `'rejected'`

### missions.priority is an ENUM
Type: `mission_priority` — valid values: `'urgent'`, `'high'`, `'normal'`, `'low'`
Must be cast or passed as string exactly matching these values.

### Supabase .insert() Does NOT Return Data by Default
You MUST chain `.select()` to get the inserted row back:
```javascript
const { data, error } = await supabase
  .from('missions')
  .insert([mission])
  .select()      // ← REQUIRED to get the row back
  .single();     // ← returns object instead of array
```

---

## BUILD REQUIREMENTS

### 1. eBay Browse API Integration

Scout searches eBay using the **Browse API** (the Finding API is deprecated).

**Authentication:** eBay Browse API uses OAuth2 Client Credentials flow.

```javascript
// Get eBay OAuth token
async function getEbayToken() {
  const credentials = Buffer.from(
    `${process.env.EBAY_APP_ID}:${process.env.EBAY_CERT_ID}`
  ).toString('base64');

  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
  });

  const { access_token } = await res.json();
  return access_token;
}
```

**Search Queries (Automated Cron Mode):**
```javascript
const CRON_SEARCH_QUERIES = [
  'MacBook Pro logic board',
  'iPhone screen replacement OEM',
  'laptop battery replacement',
  'iPad logic board',
  'Samsung Galaxy screen',
  'Dell laptop motherboard',
  'iPhone charging port flex',
  'MacBook keyboard replacement',
  'Apple Watch screen',
  'PS5 HDMI port repair'
];
```

**Search Function:**
```javascript
async function searchEbay(query, token) {
  // Exclude junk keywords
  const excludeKeywords = ['water', 'liquid', 'spill', 'corrosion',
    'icloud locked', 'bios locked', 'blacklisted', 'cracked screen lot'];
  const negFilter = excludeKeywords.map(k => `-${k}`).join(' ');

  const searchQuery = encodeURIComponent(`${query} ${negFilter}`);

  const res = await fetch(
    `https://api.ebay.com/buy/browse/v1/item_summary/search` +
    `?q=${searchQuery}` +
    `&filter=conditionIds:{3000|7000}` +   // Used + For Parts
    `&filter=itemLocationCountry:US` +
    `&filter=price:[5..500],priceCurrency:USD` +
    `&sort=newlyListed` +
    `&limit=50`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );

  const data = await res.json();
  return data.itemSummaries || [];
}
```

### 2. Manual Parts-Search Mode

Shuki sometimes needs to search for **specific repair parts** for the store. This is triggered via Telegram command or direct Supabase mission.

**Trigger:** Telegram message `/search iPhone 14 Pro Max screen` or a mission with `metadata.search_type = 'manual_parts'`

```javascript
async function handleManualSearch(query, supabase, telegram) {
  console.log(`Scout: Manual parts search — "${query}"`);
  const token = await getEbayToken();

  // Search with broader filters for parts
  const searchQuery = encodeURIComponent(query);
  const res = await fetch(
    `https://api.ebay.com/buy/browse/v1/item_summary/search` +
    `?q=${searchQuery}` +
    `&filter=itemLocationCountry:US` +
    `&filter=price:[1..1000],priceCurrency:USD` +
    `&sort=price` +       // cheapest first for parts
    `&limit=20`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );

  const data = await res.json();
  const items = data.itemSummaries || [];

  if (items.length === 0) {
    await telegram.sendMessage(
      SHUKI_TELEGRAM_ID,
      `🔍 No results for "${query}"`
    );
    return;
  }

  // Format top 5 results for Telegram
  const top5 = items.slice(0, 5);
  let message = `🔍 Parts Search: "${query}"\n\n`;

  for (const item of top5) {
    const price = item.price?.value || '?';
    const currency = item.price?.currency || 'USD';
    const condition = item.condition || 'N/A';
    const shipping = item.shippingOptions?.[0]?.shippingCost?.value || 'calc';
    const url = item.itemWebUrl;

    message += `💰 $${price} + $${shipping} ship\n`;
    message += `📦 ${item.title.substring(0, 60)}\n`;
    message += `📍 ${item.itemLocation?.postalCode || 'US'}\n`;
    message += `[View](${url})\n\n`;
  }

  message += `Found ${items.length} total results`;

  await telegram.sendMessage(SHUKI_TELEGRAM_ID, message, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true
  });

  // Also log to agent_activity
  await supabase.from('agent_activity').insert([{
    agent_id: 'scout',
    activity_type: 'manual_search',
    message: `Manual parts search: "${query}" — ${items.length} results`,
    severity: 'info'
  }]);
}
```

### 3. Ghost Protocol Implementation

Filter out low-quality deals BEFORE creating missions.

```javascript
function ghostProtocolFilter(item) {
  const title = (item.title || '').toLowerCase();

  // RED FLAG KEYWORDS
  const redFlags = ['water', 'liquid', 'spill', 'corrosion',
    'icloud', 'locked', 'bios', 'blacklisted'];
  if (redFlags.some(flag => title.includes(flag))) {
    return { pass: false, reason: 'red_flag_keyword' };
  }

  // SELLER REPUTATION
  const sellerRating = parseFloat(
    item.seller?.feedbackPercentage || '0'
  );
  const sellerFeedback = parseInt(
    item.seller?.feedbackScore || '0'
  );
  if (sellerRating < 95 && sellerFeedback < 100) {
    return { pass: false, reason: 'seller_risky' };
  }

  // PRICE EXTRACTION
  const price = parseFloat(item.price?.value || '0');
  const shippingCost = parseFloat(
    item.shippingOptions?.[0]?.shippingCost?.value || '0'
  );
  const totalCost = price + shippingCost;

  // SHIPPING RATIO CHECK
  if (price > 0 && (shippingCost / price) > 0.30) {
    return { pass: false, reason: 'shipping_expensive' };
  }

  // ESTIMATE VALUE (from price_benchmarks or fallback)
  const estimatedValue = item._estimatedValue || estimateMarketValue(title);

  // ROI CALCULATION
  const profit = estimatedValue - totalCost;
  const roi = totalCost > 0 ? (profit / totalCost) * 100 : 0;

  if (roi < 20) {
    return { pass: false, reason: 'roi_below_20pct', roi: roi.toFixed(1) };
  }

  // NON-ELECTRONICS with ROI < 100% → auto-pass
  const isElectronics = detectItemType(title) === 'electronics';
  if (!isElectronics && roi < 100) {
    return { pass: false, reason: 'non_electronics_low_roi', roi: roi.toFixed(1) };
  }

  // ✅ PASSED GHOST PROTOCOL
  return {
    pass: true,
    roi: roi.toFixed(1),
    estimatedValue: estimatedValue.toFixed(2),
    totalCost: totalCost.toFixed(2),
    profit: profit.toFixed(2),
    price: price.toFixed(2),
    shippingCost: shippingCost.toFixed(2)
  };
}
```

**Market Value Estimation (check price_benchmarks first):**
```javascript
async function getMarketValue(title, supabase) {
  const model = extractModel(title);
  const itemType = detectItemType(title);

  // Try price_benchmarks table first
  const { data } = await supabase
    .from('price_benchmarks')
    .select('avg_sold_price')
    .eq('model', model)
    .eq('item_type', itemType)
    .single();

  if (data?.avg_sold_price) {
    return parseFloat(data.avg_sold_price);
  }

  // Fallback to hardcoded benchmarks
  return estimateMarketValue(title);
}

function estimateMarketValue(title) {
  const t = title.toLowerCase();
  const benchmarks = {
    'macbook pro':  450,
    'macbook air':  350,
    'macbook':      400,
    'iphone 15':    500,
    'iphone 14':    400,
    'iphone 13':    300,
    'iphone 12':    200,
    'iphone':       250,
    'ipad pro':     350,
    'ipad':         250,
    'samsung s24':  400,
    'samsung s23':  300,
    'samsung':      200,
    'ps5':          300,
    'xbox':         250,
    'apple watch':  150,
    'airpods':      100,
    'dell':         200,
    'screen':       80,
    'logic board':  120,
    'battery':      40,
    'keyboard':     60,
    'charging port': 30,
  };

  for (const [keyword, value] of Object.entries(benchmarks)) {
    if (t.includes(keyword)) return value;
  }
  return 100; // conservative default
}

function detectItemType(title) {
  const t = title.toLowerCase();
  const electronics = ['iphone', 'samsung', 'macbook', 'ipad', 'laptop',
    'tablet', 'apple watch', 'airpods', 'ps5', 'xbox', 'switch',
    'screen', 'logic board', 'battery', 'motherboard', 'keyboard',
    'charging port', 'hdmi', 'flex cable'];
  return electronics.some(k => t.includes(k)) ? 'electronics' : 'other';
}

function extractModel(title) {
  // Extract device model for price_benchmarks lookup
  const patterns = [
    /iphone\s+\d+\s*(pro\s*max|pro|plus|mini)?/i,
    /macbook\s+(pro|air)\s*(m\d+|a\d+|1[3-6][\-"])?/i,
    /ipad\s*(pro|air|mini)?\s*\d*/i,
    /samsung\s+galaxy\s*s?\d+\s*(ultra|plus|\+)?/i,
    /dell\s+\w+\s*\d+/i,
    /ps5|playstation\s*5/i,
    /xbox\s+series\s*[xs]/i,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) return match[0].trim();
  }
  return title.substring(0, 40); // fallback: first 40 chars
}
```

### 4. Supabase Dual-Table Write

Scout inserts to BOTH `missions` (for Mission Control) AND `scout_deals` (for tracking).

```javascript
async function createDeal(item, ghostResult, supabase) {
  const title = item.title || 'Unknown Item';
  const roi = parseFloat(ghostResult.roi);

  // ── PRIORITY LOGIC ──
  let priority = 'normal';
  const hoursLeft = item.itemEndDate
    ? (new Date(item.itemEndDate) - Date.now()) / 3600000
    : 999;

  if (roi > 200 && hoursLeft < 2) priority = 'urgent';
  else if (roi > 150 || hoursLeft < 6) priority = 'high';

  // ── STEP 1: Create Mission ──
  const { data: mission, error: mErr } = await supabase
    .from('missions')
    .insert([{
      agent_id: 'scout',
      status: 'needs_shuki',        // goes straight to Shuki's column
      priority,
      title: `${title.substring(0, 80)} — ${item.price?.value || '?'}`,
      description: `ROI: ${ghostResult.roi}% | Profit: $${ghostResult.profit} | ${item.seller?.username || 'Unknown seller'}`,
      assigned_to: 'shuki'
    }])
    .select()                        // ← REQUIRED to get row back
    .single();

  if (mErr) {
    console.error('Mission insert failed:', mErr);
    throw mErr;
  }

  // ── STEP 2: Create Scout Deal (linked via mission_id) ──
  //
  // ⚠️ DO NOT insert: total_cost, profit (GENERATED columns)
  //
  const { error: dErr } = await supabase
    .from('scout_deals')
    .insert([{
      mission_id:           mission.id,                                    // FK link
      platform:             'eBay',
      item_url:             item.itemWebUrl,                               // NOT NULL!
      title:                title,
      price:                parseFloat(ghostResult.price),
      shipping_cost:        parseFloat(ghostResult.shippingCost),
      // total_cost         → GENERATED (price + shipping_cost)
      estimated_value:      parseFloat(ghostResult.estimatedValue),
      roi_percent:          parseFloat(ghostResult.roi),
      // profit             → GENERATED (estimated_value - total_cost)
      item_type:            detectItemType(title),
      model:                extractModel(title),
      condition:            item.condition || 'Used',
      location:             item.itemLocation?.postalCode || item.itemLocation?.city || 'US',
      seller_name:          item.seller?.username || null,
      seller_rating:        parseFloat(item.seller?.feedbackPercentage || '0'),
      seller_feedback_count: parseInt(item.seller?.feedbackScore || '0'),
      auction_ends_at:      item.itemEndDate || null,
      is_local_pickup:      isLocalPickup(item),
      distance_miles:       isLocalPickup(item) ? estimateDistance(item) : null,
      status:               'pending'                                      // Shuki decides
    }]);

  if (dErr) {
    console.error('Scout deal insert failed:', dErr);
    // Rollback: delete the orphan mission
    await supabase.from('missions').delete().eq('id', mission.id);
    throw dErr;
  }

  return mission;
}

function isLocalPickup(item) {
  const loc = (item.itemLocation?.city || '').toLowerCase();
  return loc.includes('miramar') || loc.includes('miami') ||
         loc.includes('pembroke') || loc.includes('hollywood') ||
         loc.includes('fort lauderdale') || loc.includes('davie');
}

function estimateDistance(item) {
  // Rough distance from Miramar, FL to common South FL cities
  const distances = {
    'miramar': 0, 'pembroke': 3, 'hollywood': 5, 'davie': 7,
    'fort lauderdale': 12, 'miami': 15, 'doral': 10, 'hialeah': 12,
    'boca raton': 30, 'west palm': 55
  };
  const loc = (item.itemLocation?.city || '').toLowerCase();
  for (const [city, miles] of Object.entries(distances)) {
    if (loc.includes(city)) return miles;
  }
  return null;
}
```

### 5. Scout Trends Logging (Ghost Protocol Passes)

Log all auto-passed deals for weekly trend analysis:

```javascript
async function logPassedDeal(item, reason, ghostResult, supabase) {
  const title = item.title || '';
  const price = parseFloat(item.price?.value || '0');
  const shipping = parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || '0');

  await supabase.from('scout_trends').insert([{
    item_type:    detectItemType(title),
    model:        extractModel(title),
    avg_price:    price + shipping,
    avg_value:    ghostResult?.estimatedValue ? parseFloat(ghostResult.estimatedValue) : estimateMarketValue(title),
    pass_reason:  reason,
    platform:     'eBay',
    metadata: {
      ebay_url:       item.itemWebUrl,
      seller_rating:  item.seller?.feedbackPercentage,
      roi:            ghostResult?.roi || null
    }
  }]);
}
```

### 6. Telegram Alerts

```javascript
const SHUKI_TELEGRAM_ID = '6103393903';

async function sendDealAlert(item, ghostResult, mission, telegram) {
  const hoursLeft = item.itemEndDate
    ? ((new Date(item.itemEndDate) - Date.now()) / 3600000).toFixed(1)
    : '∞';

  const roi = parseFloat(ghostResult.roi);
  const isUrgent = parseFloat(hoursLeft) < 1 && roi > 50;

  const header = isUrgent
    ? `🚨 URGENT DEAL — ENDING IN ${Math.round(parseFloat(hoursLeft) * 60)}m`
    : `🔍 NEW DEAL FOUND`;

  const message = `${header}

📦 ${item.title?.substring(0, 60)}
💰 $${ghostResult.price} + $${ghostResult.shippingCost} ship
📊 Value: $${ghostResult.estimatedValue} | ROI: ${ghostResult.roi}%
💵 Profit: +$${ghostResult.profit}
👤 ${item.seller?.username || '?'} (${item.seller?.feedbackPercentage || '?'}%)
⏰ Ends: ${hoursLeft}h
📍 ${item.itemLocation?.city || 'US'}

[View on eBay](${item.itemWebUrl})`;

  await telegram.sendMessage(SHUKI_TELEGRAM_ID, message, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true
  });

  // Also queue in telegram_notifications table
  await supabase.from('telegram_notifications').insert([{
    mission_id: mission.id,
    message: `${isUrgent ? '🚨' : '🔍'} ${item.title?.substring(0, 50)} — $${ghostResult.price} → $${ghostResult.estimatedValue} (${ghostResult.roi}% ROI)`,
    priority: isUrgent ? 'urgent' : (roi > 100 ? 'high' : 'normal'),
    actions: { approve: true, reject: true, ask_jay: true },
    status: 'sent'
  }]);
}
```

### 7. Main Scout Execution (Cron Mode)

```javascript
const { createClient } = require('@supabase/supabase-js');
const TelegramBot = require('node-telegram-bot-api');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const telegram = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

async function runScoutCycle() {
  console.log('Scout: Starting deal search...');

  // Heartbeat: mark active
  await supabase
    .from('agents')
    .update({ status: 'active', last_heartbeat: new Date().toISOString() })
    .eq('id', 'scout');

  try {
    const token = await getEbayToken();
    let approved = 0;
    let passed = 0;
    let errors = 0;

    for (const query of CRON_SEARCH_QUERIES) {
      try {
        const items = await searchEbay(query, token);
        console.log(`  "${query}" → ${items.length} results`);

        for (const item of items) {
          // Enrich with market value from DB
          item._estimatedValue = await getMarketValue(item.title || '', supabase);

          const ghostResult = ghostProtocolFilter(item);

          if (ghostResult.pass) {
            const mission = await createDeal(item, ghostResult, supabase);
            await sendDealAlert(item, ghostResult, mission, telegram);
            approved++;
          } else {
            await logPassedDeal(item, ghostResult.reason, ghostResult, supabase);
            passed++;
          }
        }
      } catch (queryErr) {
        console.error(`  Error on "${query}":`, queryErr.message);
        errors++;
      }

      // Rate limit: pause between queries
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`Scout cycle complete: ${approved} approved, ${passed} passed, ${errors} errors`);

    // Summary notification
    await telegram.sendMessage(
      SHUKI_TELEGRAM_ID,
      `✅ Scout cycle complete\n📥 ${approved} deals queued\n👻 ${passed} ghost-passed\n${errors > 0 ? `⚠️ ${errors} errors` : ''}`
    );

    // Log activity
    await supabase.from('agent_activity').insert([{
      agent_id: 'scout',
      activity_type: 'scan_complete',
      message: `Cycle done: ${approved} approved, ${passed} passed, ${errors} errors`,
      severity: errors > 0 ? 'warning' : 'info'
    }]);

  } catch (error) {
    console.error('Scout fatal error:', error);
    await telegram.sendMessage(
      SHUKI_TELEGRAM_ID,
      `❌ Scout error: ${error.message}`
    );
    await supabase.from('agent_activity').insert([{
      agent_id: 'scout',
      activity_type: 'error',
      message: `Fatal: ${error.message}`,
      severity: 'error'
    }]);
  }

  // Heartbeat: mark idle
  await supabase
    .from('agents')
    .update({ status: 'idle', last_heartbeat: new Date().toISOString() })
    .eq('id', 'scout');
}

// ── Telegram Command Listener (for manual searches) ──
telegram.onText(/\/search (.+)/, async (msg, match) => {
  if (String(msg.from.id) !== SHUKI_TELEGRAM_ID) return; // only Shuki
  const query = match[1];
  await handleManualSearch(query, supabase, telegram);
});

// Export for OpenClaw spawn
module.exports = { runScoutCycle, handleManualSearch };
```

---

## ENVIRONMENT VARIABLES

```env
EBAY_APP_ID=your_ebay_app_id
EBAY_CERT_ID=your_ebay_cert_id
SUPABASE_URL=https://djusjenyxujukdydhajp.supabase.co
SUPABASE_SERVICE_KEY=your_supabase_service_key
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
SHUKI_TELEGRAM_ID=6103393903
```

> **Note:** Uses `EBAY_APP_ID` + `EBAY_CERT_ID` (OAuth2 Client Credentials), NOT a single `EBAY_API_KEY`. The Finding API is deprecated — we use the Browse API.

---

## DEPLOYMENT: OpenClaw Cron

```bash
openclaw cron add \
  --schedule "0 */2 * * *" \
  --sessionTarget isolated \
  --payload.kind agentTurn \
  --payload.message "Run Scout deal search per SCOUT_AGENT_PROMPT.md" \
  --delivery.mode announce \
  --delivery.channel telegram \
  --delivery.to 6103393903
```

---

## TESTING CHECKLIST

Before marking complete:

- [ ] eBay OAuth2 token obtained (Browse API, not Finding API)
- [ ] Search returns results (check `itemSummaries` array)
- [ ] Ghost Protocol rejects <20% ROI deals correctly
- [ ] Ghost Protocol rejects non-electronics <100% ROI
- [ ] Ghost Protocol rejects sellers with <95% rating AND <100 feedback
- [ ] `missions` row created with `.select().single()` returning UUID
- [ ] `scout_deals` row created with valid `mission_id` FK
- [ ] `scout_deals` does NOT insert `total_cost` or `profit` (GENERATED)
- [ ] `scout_deals.status` = `'pending'` (not `'pending_approval'`)
- [ ] `scout_deals.item_url` is always populated (NOT NULL constraint)
- [ ] `scout_trends` logs auto-passed deals with reason
- [ ] Telegram deal alert sends with eBay link
- [ ] Telegram urgent alert fires for <1h + >50% ROI
- [ ] Telegram summary notification after each cycle
- [ ] Manual `/search` command works (parts-search mode)
- [ ] `agent_activity` logged for scan_complete, error, manual_search
- [ ] Heartbeat updates `agents.status` + `last_heartbeat`
- [ ] Error handling: no silent failures, orphan missions cleaned up
- [ ] Full cycle runs in <5 minutes
- [ ] `price_benchmarks` table queried before fallback estimates

---

## SUCCESS CRITERIA

Scout is complete when:

- ✅ Finds 20–50 listings per cycle across all queries
- ✅ 3–8 deals pass Ghost Protocol per cycle
- ✅ Mission Control dashboard shows live deals in "Needs Shuki" column
- ✅ Urgent auction alerts trigger correctly (<1h + >50% ROI)
- ✅ `scout_trends` populated (for weekly Ghost Protocol analysis)
- ✅ Manual `/search` returns top 5 parts results in Telegram
- ✅ Cron job stable (no unhandled errors over 24h)
- ✅ Dashboard "Approve" and "Pass" buttons work on Scout deals

---

## COLUMN QUICK-REFERENCE

### scout_deals table
| Column | Type | Notes |
|---|---|---|
| `mission_id` | UUID FK | Links to missions.id |
| `platform` | TEXT | 'eBay', 'Amazon', etc. |
| `item_url` | TEXT NOT NULL | Full listing URL |
| `title` | TEXT NOT NULL | Item title |
| `price` | DECIMAL | Buy price |
| `shipping_cost` | DECIMAL | Default 0 |
| `total_cost` | DECIMAL **GENERATED** | ❌ NEVER INSERT |
| `estimated_value` | DECIMAL NOT NULL | From price_benchmarks or estimate |
| `roi_percent` | DECIMAL NOT NULL | You calculate |
| `profit` | DECIMAL **GENERATED** | ❌ NEVER INSERT |
| `item_type` | TEXT | 'electronics', 'other' |
| `model` | TEXT | Device model for benchmarks |
| `condition` | TEXT | 'Used', 'For Parts', etc. |
| `location` | TEXT | Seller location |
| `seller_name` | TEXT | Seller username |
| `seller_rating` | DECIMAL | Percentage (99.8) |
| `seller_feedback_count` | INT | Number of reviews |
| `auction_ends_at` | TIMESTAMPTZ | NULL for BIN |
| `is_local_pickup` | BOOLEAN | Default false |
| `distance_miles` | DECIMAL | Only if local pickup |
| `status` | TEXT | `pending` / `approved` / `rejected` / `purchased` |

### missions table (Scout creates these)
| Column | Value |
|---|---|
| `agent_id` | `'scout'` |
| `status` | `'needs_shuki'` |
| `priority` | `'urgent'` / `'high'` / `'normal'` |
| `title` | Item title + price |
| `description` | ROI + profit + seller info |
| `assigned_to` | `'shuki'` |
