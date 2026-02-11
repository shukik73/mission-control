# Scout Implementation Prompt for Claude Code

Use this prompt with Claude Code to build Scout Agent ready for OpenClaw deployment.

---

## CONTEXT

Scout is an autonomous eBay deal-finder for Techy Miramar. It runs every 2 hours via OpenClaw cron, searches eBay for refurbished/used electronics, filters deals through "Ghost Protocol" (auto-passes low-quality deals), and inserts qualified deals into Supabase Mission Control.

**System Prompt Reference:** SCOUT_AGENT_PROMPT.md (GitHub)

**Deployment Model:** OpenClaw cron spawn (every 2 hours)

**Tech Stack:**
- eBay API (production, not sandbox)
- Supabase client (JavaScript/Node)
- Telegram bot API
- Node.js 18+

---

## BUILD REQUIREMENTS

### 1. eBay API Integration

Scout searches eBay for target categories using the eBay Finding API.

**Target Search Queries:**
```javascript
const SEARCH_QUERIES = [
  'MacBook Pro logic board',
  'iPhone screen replacement',
  'laptop battery',
  'iPad logic board',
  'TV repair parts',
  'Samsung screen',
  'Dell laptop motherboard'
];
```

**Search Parameters:**
- Item condition: "Used" + "For Parts or Not Working"
- Location: United States
- Sort: By bid count (descending) — proxy for market demand
- Results: Top 50 per query
- Exclude: Items with keywords ['water', 'liquid', 'spill', 'corrosion', 'icloud locked', 'bios locked', 'blacklisted']

**Code Template:**
```javascript
const ebay = require('ebay-api');

const eBayClient = new ebay.EBayApiClient({
  apiKey: process.env.EBAY_API_KEY,
  baseUrl: 'https://svcs.ebay.com' // Production
});

async function searchEbay() {
  const listings = [];
  
  for (const query of SEARCH_QUERIES) {
    const results = await eBayClient.findItemsAdvanced({
      keywords: query,
      outputSelector: ['AspectHistogram', 'SellerInfo'],
      itemFilter: [
        { name: 'Condition', value: ['Used', 'ForPartsOrNotWorking'] },
        { name: 'LocatedIn', value: 'United States' },
        { name: 'MinPrice', value: '5' },
        { name: 'MaxPrice', value: '500' }
      ],
      sortOrder: 'BidCountDescending',
      paginationInput: {
        pageNumber: 1,
        entriesPerPage: 50
      }
    });
    
    if (results.findItemsAdvancedResponse?.[0]?.searchResult?.[0]?.item) {
      listings.push(...results.findItemsAdvancedResponse[0].searchResult[0].item);
    }
  }
  
  return listings;
}
```

### 2. Ghost Protocol Implementation

Filter out low-quality deals BEFORE creating missions.

**Auto-Pass Logic:**
```javascript
function ghostProtocolFilter(listing) {
  const { title, sellingStatus, seller, shipping, condition } = listing;
  
  // RED FLAG KEYWORDS
  const redFlags = ['water', 'liquid', 'spill', 'corrosion', 'icloud', 'locked', 'bios', 'blacklisted'];
  if (redFlags.some(flag => title.toLowerCase().includes(flag))) {
    return { pass: false, reason: 'red_flag' };
  }
  
  // SELLER REPUTATION
  const sellerRating = parseFloat(seller?.[0]?.feedbackRating?.[0] || 0);
  if (sellerRating < 90) {
    return { pass: false, reason: 'seller_low_rating' };
  }
  
  // SHIPPING COST CHECK
  const itemPrice = parseFloat(sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || 0);
  const shippingCost = parseFloat(shipping?.[0]?.shippingServiceCost?.[0]?.__value__ || 0);
  const shippingRatio = shippingCost / itemPrice;
  
  if (shippingRatio > 0.30) {
    return { pass: false, reason: 'shipping_expensive' };
  }
  
  // ROI CALCULATION
  const estimatedValue = estimateMarketValue(title);
  const totalCost = itemPrice + shippingCost;
  const roi = ((estimatedValue - totalCost) / totalCost) * 100;
  
  if (roi < 20) {
    return { pass: false, reason: 'roi_too_low', roi };
  }
  
  // PASSED GHOST PROTOCOL
  return {
    pass: true,
    roi: roi.toFixed(1),
    estimatedValue: estimatedValue.toFixed(2),
    totalCost: totalCost.toFixed(2),
    profit: (estimatedValue - totalCost).toFixed(2)
  };
}

function estimateMarketValue(title) {
  // Simple lookup based on device type + condition
  // TODO: Connect to price_benchmarks table for live market data
  
  const benchmarks = {
    'macbook': 400,
    'iphone': 300,
    'ipad': 250,
    'samsung': 200,
    'laptop': 300,
    'screen': 150
  };
  
  for (const [device, value] of Object.entries(benchmarks)) {
    if (title.toLowerCase().includes(device)) {
      return value;
    }
  }
  
  return 150; // default
}
```

### 3. Supabase Dual-Table Write

Scout inserts to BOTH `missions` (for Mission Control) AND `scout_deals` (for tracking).

**Missions Table:**
```javascript
async function createMission(listing, ghostProtocolResult, supabase) {
  const mission = {
    agent_id: 'scout',
    status: 'inbox',
    priority: ghostProtocolResult.roi > 100 ? 'urgent' : 'high',
    title: listing.title[0],
    description: `eBay deal: ${listing.title[0]}`,
    assigned_to: 'jay',
    metadata: {
      ebay_item_id: listing.itemId[0],
      ebay_url: listing.viewItemURL[0],
      cost: ghostProtocolResult.totalCost,
      shipping: parseFloat(listing.shipping?.[0]?.shippingServiceCost?.[0].__value__ || 0),
      estimated_value: ghostProtocolResult.estimatedValue,
      roi_percent: ghostProtocolResult.roi,
      profit: ghostProtocolResult.profit,
      seller_name: listing.seller[0].sellerUserName[0],
      seller_rating: parseFloat(listing.seller[0].feedbackRating[0]),
      location: listing.location[0],
      auction_ends_at: new Date(listing.listingInfo[0].endTime[0]).toISOString(),
      local_pickup: listing.shippingInfo?.[0]?.shipToLocations?.includes('Miramar, FL'),
      ghost_protocol_passed: true
    }
  };
  
  const { data, error } = await supabase
    .from('missions')
    .insert([mission]);
  
  return data?.[0];
}
```

**Scout Deals Table:**
```javascript
async function recordScoutDeal(listing, ghostProtocolResult, missionId, supabase) {
  const scoutDeal = {
    mission_id: missionId,
    item_id: listing.itemId[0],
    item_title: listing.title[0],
    item_url: listing.viewItemURL[0],
    item_type: extractDeviceType(listing.title[0]),
    price: ghostProtocolResult.totalCost,
    estimated_value: ghostProtocolResult.estimatedValue,
    roi_percent: ghostProtocolResult.roi,
    profit: ghostProtocolResult.profit,
    seller_name: listing.seller[0].sellerUserName[0],
    seller_feedback_count: parseInt(listing.seller[0].feedbackScore[0]),
    seller_rating: parseFloat(listing.seller[0].feedbackRating[0]),
    location: listing.location[0],
    distance_miles: calculateDistance('Miramar, FL', listing.location[0]),
    local_pickup: listing.shippingInfo?.[0]?.shipToLocations?.includes('Miramar, FL'),
    auction_ends_at: new Date(listing.listingInfo[0].endTime[0]).toISOString(),
    status: 'pending_approval',
    created_at: new Date().toISOString()
  };
  
  await supabase.from('scout_deals').insert([scoutDeal]);
}
```

### 4. Scout Trends Logging (Auto-Pass)

Log all passed deals for weekly trend analysis.

```javascript
async function logPassedDeal(listing, reason, ghostProtocolResult, supabase) {
  const passed = {
    item_type: extractDeviceType(listing.title[0]),
    item_model: extractModel(listing.title[0]),
    item_price: ghostProtocolResult.totalCost,
    estimated_value: ghostProtocolResult.estimatedValue,
    roi_if_sold: ghostProtocolResult.roi,
    pass_reason: reason,
    seller_rating: parseFloat(listing.seller[0].feedbackRating[0]),
    location: listing.location[0],
    passed_at: new Date().toISOString()
  };
  
  await supabase.from('scout_trends').insert([passed]);
}
```

### 5. Telegram Alerts (Urgent Auctions)

Send alerts for time-sensitive deals.

```javascript
async function checkUrgentAuction(listing, ghostProtocolResult, telegramClient) {
  const endTime = new Date(listing.listingInfo[0].endTime[0]);
  const hoursLeft = (endTime - Date.now()) / (1000 * 60 * 60);
  
  // Alert if <1h AND ROI > 50%
  if (hoursLeft < 1 && ghostProtocolResult.roi > 50) {
    const message = `
🚨 AUCTION ENDING IN ${Math.round(hoursLeft * 60)}m

${listing.title[0]}
eBay • ${listing.location[0]}

Cost: $${ghostProtocolResult.totalCost}
Est Value: $${ghostProtocolResult.estimatedValue}
ROI: ${ghostProtocolResult.roi}%

Seller: ${listing.seller[0].sellerUserName[0]} (${parseFloat(listing.seller[0].feedbackRating[0])}%)

[View on eBay](${listing.viewItemURL[0]})
    `;
    
    await telegramClient.sendMessage(SHUKI_TELEGRAM_ID, message);
  }
}
```

### 6. Main Scout Execution

Orchestrate the full pipeline.

```javascript
async function runScoutCycle(supabase, telegramClient) {
  console.log('Scout: Starting deal search...');
  
  try {
    // 1. Search eBay
    const listings = await searchEbay();
    console.log(`Found ${listings.length} listings`);
    
    let approved = 0;
    let passed = 0;
    
    // 2. Filter & process each listing
    for (const listing of listings) {
      const ghostResult = ghostProtocolFilter(listing);
      
      if (ghostResult.pass) {
        // 3. Create mission + scout_deal record
        const mission = await createMission(listing, ghostResult, supabase);
        await recordScoutDeal(listing, ghostResult, mission.id, supabase);
        
        // 4. Check for urgent auction alert
        await checkUrgentAuction(listing, ghostResult, telegramClient);
        
        approved++;
      } else {
        // Log passed deals for trends
        await logPassedDeal(listing, ghostResult.reason, ghostResult, supabase);
        passed++;
      }
    }
    
    console.log(`Scout cycle complete: ${approved} approved, ${passed} passed`);
    
    // 5. Summary telegram notification
    await telegramClient.sendMessage(
      SHUKI_TELEGRAM_ID,
      `✅ Scout cycle complete\n${approved} deals approved\n${passed} deals passed`
    );
    
  } catch (error) {
    console.error('Scout error:', error);
    await telegramClient.sendMessage(
      SHUKI_TELEGRAM_ID,
      `❌ Scout error: ${error.message}`
    );
  }
}

// Export for OpenClaw spawn
module.exports = { runScoutCycle };
```

---

## ENVIRONMENT VARIABLES

Scout needs these in `.env`:

```
EBAY_API_KEY=your_ebay_api_key
SUPABASE_URL=https://djusjenyxujukdydhajp.supabase.co
SUPABASE_SERVICE_KEY=your_supabase_service_key
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
SHUKI_TELEGRAM_ID=6103393903
```

---

## DEPLOYMENT: OpenClaw Cron

Once Scout is built, deploy with:

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

This spawns Scout every 2 hours (cron `0 */2 * * *`), runs the search, and announces results to Telegram.

---

## TESTING CHECKLIST

Before marking complete:

- [ ] eBay API connection works (search returns results)
- [ ] Ghost Protocol filters correctly (rejects <20% ROI)
- [ ] Missions created in Supabase (check dashboard)
- [ ] scout_deals records inserted
- [ ] scout_trends logs auto-passed deals
- [ ] Urgent auction alerts send to Telegram (<1h + >50% ROI)
- [ ] Summary notification sent after each cycle
- [ ] Error handling graceful (no silent failures)
- [ ] Runs in <5 minutes per cycle

---

## SUCCESS CRITERIA

Scout is complete when:
- ✅ Finds 20-50 deals per cycle
- ✅ 3-8 deals pass Ghost Protocol per cycle
- ✅ Mission Control dashboard shows live deals
- ✅ Urgent auction alerts trigger correctly
- ✅ Trends database populated (for weekly analysis)
- ✅ Cron job stable (no errors over 24h)
