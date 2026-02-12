import { createClient } from '@supabase/supabase-js';

// ── CONFIG ──
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const EBAY_APP_ID = process.env.EBAY_APP_ID!;
const EBAY_CERT_ID = process.env.EBAY_CERT_ID!;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const SHUKI_TELEGRAM_ID = process.env.SHUKI_TELEGRAM_ID!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── SEARCH QUERIES (Automated Cron Mode) ──
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
  'PS5 HDMI port repair',
];

// ── eBay OAuth2 Token ──
async function getEbayToken(): Promise<string> {
  const credentials = Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString('base64');

  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay OAuth failed: ${res.status} ${text}`);
  }

  const { access_token } = await res.json();
  return access_token;
}

// ── eBay Browse API Search ──
async function searchEbay(query: string, token: string) {
  const excludeKeywords = [
    'water', 'liquid', 'spill', 'corrosion',
    'icloud locked', 'bios locked', 'blacklisted', 'cracked screen lot',
  ];
  const negFilter = excludeKeywords.map((k) => `-${k}`).join(' ');
  const searchQuery = encodeURIComponent(`${query} ${negFilter}`);

  const res = await fetch(
    `https://api.ebay.com/buy/browse/v1/item_summary/search` +
      `?q=${searchQuery}` +
      `&filter=conditionIds:{3000|7000}` +
      `&filter=itemLocationCountry:US` +
      `&filter=price:[5..500],priceCurrency:USD` +
      `&sort=newlyListed` +
      `&limit=50`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay search failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.itemSummaries || [];
}

// ── Title Sanitization (prompt injection mitigation) ──
function sanitizeTitle(raw: string): string {
  // Strip control characters and zero-width chars
  let clean = raw.replace(/[\x00-\x1F\x7F\u200B-\u200F\uFEFF]/g, '');
  // Collapse whitespace
  clean = clean.replace(/\s+/g, ' ').trim();
  // Cap length to prevent payload stuffing
  return clean.substring(0, 200);
}

// ── Ghost Protocol Filter ──
function ghostProtocolFilter(item: any) {
  const title = (item.title || '').toLowerCase();

  // RED FLAG KEYWORDS
  const redFlags = ['water', 'liquid', 'spill', 'corrosion', 'icloud', 'locked', 'bios', 'blacklisted'];
  if (redFlags.some((flag) => title.includes(flag))) {
    return { pass: false, reason: 'red_flag_keyword' };
  }

  // SELLER REPUTATION — reject if rating < 90% OR feedback count < 50
  const sellerRating = parseFloat(item.seller?.feedbackPercentage || '0');
  const sellerFeedback = parseInt(item.seller?.feedbackScore || '0', 10);
  if (sellerRating < 90 || sellerFeedback < 50) {
    return { pass: false, reason: 'seller_risky' };
  }

  // PRICE EXTRACTION
  const price = parseFloat(item.price?.value || '0');
  const shippingCost = parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || '0');
  const totalCost = price + shippingCost;

  // SHIPPING RATIO CHECK
  if (price > 0 && shippingCost / price > 0.3) {
    return { pass: false, reason: 'shipping_expensive' };
  }

  // ESTIMATE VALUE
  const estimatedValue = item._estimatedValue || estimateMarketValue(title);

  // ROI CALCULATION — includes platform fees (eBay 12.9% + payment 2.9%)
  const ebayFee = (estimatedValue * 0.129) + 0.30;
  const paymentFee = (estimatedValue * 0.029) + 0.30;
  const platformFees = ebayFee + paymentFee;
  const netRevenue = estimatedValue - platformFees;
  const profit = netRevenue - totalCost;
  const roi = totalCost > 0 ? (profit / totalCost) * 100 : 0;

  if (roi < 20) {
    return { pass: false, reason: 'roi_below_20pct', roi: roi.toFixed(1) };
  }

  // NON-ELECTRONICS with ROI < 100% -> auto-pass
  const isElectronics = detectItemType(title) === 'electronics';
  if (!isElectronics && roi < 100) {
    return { pass: false, reason: 'non_electronics_low_roi', roi: roi.toFixed(1) };
  }

  // PASSED GHOST PROTOCOL
  return {
    pass: true,
    roi: roi.toFixed(1),
    estimatedValue: estimatedValue.toFixed(2),
    totalCost: totalCost.toFixed(2),
    profit: profit.toFixed(2),
    platformFees: platformFees.toFixed(2),
    price: price.toFixed(2),
    shippingCost: shippingCost.toFixed(2),
  };
}

// ── Market Value Estimation ──
async function getMarketValue(title: string): Promise<number> {
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

  return estimateMarketValue(title);
}

function estimateMarketValue(title: string): number {
  const t = title.toLowerCase();
  const benchmarks: Record<string, number> = {
    'macbook pro': 450, 'macbook air': 350, macbook: 400,
    'iphone 15': 500, 'iphone 14': 400, 'iphone 13': 300, 'iphone 12': 200, iphone: 250,
    'ipad pro': 350, ipad: 250,
    'samsung s24': 400, 'samsung s23': 300, samsung: 200,
    ps5: 300, xbox: 250, 'apple watch': 150, airpods: 100, dell: 200,
    screen: 80, 'logic board': 120, battery: 40, keyboard: 60, 'charging port': 30,
  };

  for (const [keyword, value] of Object.entries(benchmarks)) {
    if (t.includes(keyword)) return value;
  }
  return 100;
}

function detectItemType(title: string): string {
  const t = title.toLowerCase();
  const electronics = [
    'iphone', 'samsung', 'macbook', 'ipad', 'laptop', 'tablet', 'apple watch',
    'airpods', 'ps5', 'xbox', 'switch', 'screen', 'logic board', 'battery',
    'motherboard', 'keyboard', 'charging port', 'hdmi', 'flex cable',
  ];
  return electronics.some((k) => t.includes(k)) ? 'electronics' : 'other';
}

function extractModel(title: string): string {
  const patterns = [
    /iphone\s+\d+\s*(pro\s*max|pro|plus|mini)?/i,
    /macbook\s+(pro|air)\s*(m\d+|a\d+|1[3-6][-"])?/i,
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
  return title.substring(0, 40);
}

// ── Dual-Table Write ──
async function createDeal(item: any, ghostResult: any) {
  const title = sanitizeTitle(item.title || 'Unknown Item');
  const roi = parseFloat(ghostResult.roi);

  // PRIORITY LOGIC
  let priority = 'normal';
  const hoursLeft = item.itemEndDate
    ? (new Date(item.itemEndDate).getTime() - Date.now()) / 3600000
    : 999;

  if (roi > 200 && hoursLeft < 2) priority = 'urgent';
  else if (roi > 150 || hoursLeft < 6) priority = 'high';

  // STEP 1: Create Mission
  const { data: mission, error: mErr } = await supabase
    .from('missions')
    .insert([
      {
        agent_id: 'scout',
        status: 'needs_shuki',
        priority,
        title: `${title.substring(0, 80)} — ${item.price?.value || '?'}`,
        description: `ROI: ${ghostResult.roi}% | Profit: $${ghostResult.profit} | ${item.seller?.username || 'Unknown seller'}`,
        assigned_to: 'shuki',
      },
    ])
    .select()
    .single();

  if (mErr) {
    console.error('Mission insert failed:', mErr);
    throw mErr;
  }

  // STEP 2: Create Scout Deal (linked via mission_id)
  // DO NOT insert: total_cost, profit (GENERATED columns)
  const { error: dErr } = await supabase.from('scout_deals').insert([
    {
      mission_id: mission.id,
      platform: 'eBay',
      item_url: item.itemWebUrl,
      title,
      price: parseFloat(ghostResult.price),
      shipping_cost: parseFloat(ghostResult.shippingCost),
      // total_cost -> GENERATED (price + shipping_cost)
      estimated_value: parseFloat(ghostResult.estimatedValue),
      roi_percent: parseFloat(ghostResult.roi),
      // profit -> GENERATED (estimated_value - total_cost)
      item_type: detectItemType(title),
      model: extractModel(title),
      condition: item.condition || 'Used',
      location: item.itemLocation?.postalCode || item.itemLocation?.city || 'US',
      seller_name: item.seller?.username || null,
      seller_rating: parseFloat(item.seller?.feedbackPercentage || '0'),
      seller_feedback_count: parseInt(item.seller?.feedbackScore || '0', 10),
      auction_ends_at: item.itemEndDate || null,
      is_local_pickup: isLocalPickup(item),
      distance_miles: isLocalPickup(item) ? estimateDistance(item) : null,
      status: 'pending',
    },
  ]);

  if (dErr) {
    console.error('Scout deal insert failed:', dErr);
    // Rollback: delete the orphan mission
    await supabase.from('missions').delete().eq('id', mission.id);
    throw dErr;
  }

  return mission;
}

function isLocalPickup(item: any): boolean {
  const loc = (item.itemLocation?.city || '').toLowerCase();
  return (
    loc.includes('miramar') || loc.includes('miami') || loc.includes('pembroke') ||
    loc.includes('hollywood') || loc.includes('fort lauderdale') || loc.includes('davie')
  );
}

function estimateDistance(item: any): number | null {
  const distances: Record<string, number> = {
    miramar: 0, pembroke: 3, hollywood: 5, davie: 7,
    'fort lauderdale': 12, miami: 15, doral: 10, hialeah: 12,
    'boca raton': 30, 'west palm': 55,
  };
  const loc = (item.itemLocation?.city || '').toLowerCase();
  for (const [city, miles] of Object.entries(distances)) {
    if (loc.includes(city)) return miles;
  }
  return null;
}

// ── Scout Trends Logging ──
async function logPassedDeal(item: any, reason: string, ghostResult: any) {
  const title = item.title || '';
  const price = parseFloat(item.price?.value || '0');
  const shipping = parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || '0');

  await supabase.from('scout_trends').insert([
    {
      item_type: detectItemType(title),
      model: extractModel(title),
      avg_price: price + shipping,
      avg_value: ghostResult?.estimatedValue
        ? parseFloat(ghostResult.estimatedValue)
        : estimateMarketValue(title),
      pass_reason: reason,
      platform: 'eBay',
      metadata: {
        ebay_url: item.itemWebUrl,
        seller_rating: item.seller?.feedbackPercentage,
        roi: ghostResult?.roi || null,
      },
    },
  ]);
}

// ── Telegram Alerts ──
async function sendTelegram(message: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: SHUKI_TELEGRAM_ID,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });
}

async function sendDealAlert(item: any, ghostResult: any, mission: any) {
  const hoursLeft = item.itemEndDate
    ? ((new Date(item.itemEndDate).getTime() - Date.now()) / 3600000).toFixed(1)
    : '\u221E';

  const roi = parseFloat(ghostResult.roi);
  const isUrgent = parseFloat(hoursLeft) < 1 && roi > 50;

  const header = isUrgent
    ? `\uD83D\uDEA8 URGENT DEAL \u2014 ENDING IN ${Math.round(parseFloat(hoursLeft) * 60)}m`
    : `\uD83D\uDD0D NEW DEAL FOUND`;

  const message = `${header}

\uD83D\uDCE6 ${item.title?.substring(0, 60)}
\uD83D\uDCB0 $${ghostResult.price} + $${ghostResult.shippingCost} ship
\uD83D\uDCCA Value: $${ghostResult.estimatedValue} | ROI: ${ghostResult.roi}%
\uD83D\uDCB5 Profit: +$${ghostResult.profit}
\uD83D\uDC64 ${item.seller?.username || '?'} (${item.seller?.feedbackPercentage || '?'}%)
\u23F0 Ends: ${hoursLeft}h
\uD83D\uDCCD ${item.itemLocation?.city || 'US'}

[View on eBay](${item.itemWebUrl})`;

  await sendTelegram(message);

  // Queue in telegram_notifications table
  await supabase.from('telegram_notifications').insert([
    {
      mission_id: mission.id,
      message: `${isUrgent ? '\uD83D\uDEA8' : '\uD83D\uDD0D'} ${item.title?.substring(0, 50)} \u2014 $${ghostResult.price} \u2192 $${ghostResult.estimatedValue} (${ghostResult.roi}% ROI)`,
      priority: isUrgent ? 'urgent' : roi > 100 ? 'high' : 'normal',
      actions: { approve: true, reject: true, ask_jay: true },
      status: 'sent',
    },
  ]);
}

// ── MAIN SCOUT CRON HANDLER ──
export async function GET(request: Request) {
  // Verify cron secret (Vercel sends this header for cron invocations)
  // FAIL CLOSED: if CRON_SECRET is not configured, deny all requests
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return new Response(JSON.stringify({ error: 'Server misconfigured: CRON_SECRET not set' }), { status: 500 });
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  console.log('Scout: Starting cron deal search...');

  // Heartbeat: mark active
  await supabase
    .from('agents')
    .update({ status: 'active', last_heartbeat: new Date().toISOString() })
    .eq('id', 'scout');

  let approved = 0;
  let passed = 0;
  let errors = 0;

  try {
    const token = await getEbayToken();

    for (const query of CRON_SEARCH_QUERIES) {
      try {
        const items = await searchEbay(query, token);
        console.log(`  "${query}" -> ${items.length} results`);

        for (const item of items) {
          // Currency validation — skip non-USD listings
          const currency = item.price?.currency || item.price?.currencyCode || 'USD';
          if (currency !== 'USD') {
            passed++;
            continue;
          }

          // Dedup check — skip if item_url already exists in scout_deals
          if (item.itemWebUrl) {
            const { data: existing } = await supabase
              .from('scout_deals')
              .select('id')
              .eq('item_url', item.itemWebUrl)
              .limit(1);

            if (existing && existing.length > 0) {
              continue; // already tracked
            }
          }

          // Enrich with market value from DB
          item._estimatedValue = await getMarketValue(item.title || '');

          const ghostResult = ghostProtocolFilter(item);

          if (ghostResult.pass) {
            const mission = await createDeal(item, ghostResult);
            await sendDealAlert(item, ghostResult, mission);
            approved++;
          } else {
            await logPassedDeal(item, ghostResult.reason!, ghostResult);
            passed++;
          }
        }
      } catch (queryErr: any) {
        console.error(`  Error on "${query}":`, queryErr.message);
        errors++;
      }

      // Rate limit: pause between queries
      await new Promise((r) => setTimeout(r, 1000));
    }

    console.log(`Scout cycle complete: ${approved} approved, ${passed} passed, ${errors} errors`);

    // Summary notification
    await sendTelegram(
      `\u2705 Scout cycle complete\n\uD83D\uDCE5 ${approved} deals queued\n\uD83D\uDC7B ${passed} ghost-passed${errors > 0 ? `\n\u26A0\uFE0F ${errors} errors` : ''}`
    );

    // Log activity
    await supabase.from('agent_activity').insert([
      {
        agent_id: 'scout',
        activity_type: 'scan_complete',
        message: `Cycle done: ${approved} approved, ${passed} passed, ${errors} errors`,
        severity: errors > 0 ? 'warning' : 'info',
      },
    ]);
  } catch (error: any) {
    console.error('Scout fatal error:', error);
    await sendTelegram(`\u274C Scout error: ${error.message}`);
    await supabase.from('agent_activity').insert([
      {
        agent_id: 'scout',
        activity_type: 'error',
        message: `Fatal: ${error.message}`,
        severity: 'error',
      },
    ]);
  }

  // Heartbeat: mark idle
  await supabase
    .from('agents')
    .update({ status: 'idle', last_heartbeat: new Date().toISOString() })
    .eq('id', 'scout');

  return new Response(
    JSON.stringify({
      success: true,
      approved,
      passed,
      errors,
      timestamp: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
