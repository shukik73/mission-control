import { createClient } from '@supabase/supabase-js';

// ── CONFIG ──
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL!;
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID!;
const GOOGLE_SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY!;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const SHUKI_TELEGRAM_ID = '6103393903';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── SEARCH QUERIES (Automated Cron Mode — rotate through) ──
const CRON_SEARCH_QUERIES = [
  'Phone Repair Miami FL',
  'Computer Repair Miramar FL',
  'Electronics Store Hialeah FL',
  'iPhone Screen Repair Fort Lauderdale FL',
  'Laptop Repair Doral FL',
  'Cell Phone Store Pembroke Pines FL',
];

// ── Google Sheets Auth ──
async function getGoogleAccessToken(): Promise<string> {
  // Parse service account key from env
  const sa = JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY);

  // Build JWT
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = btoa(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );

  // Sign with private key using Web Crypto
  const pemContents = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');
  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(`${header}.${payload}`)
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const jwt = `${header}.${payload}.${signature}`;

  // Exchange JWT for access token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google OAuth failed: ${res.status} ${text}`);
  }

  const { access_token } = await res.json();
  return access_token;
}

// ── Read Google Sheets ──
interface SheetRow {
  business_name: string;
  address: string;
  phone: string;
  website: string;
  google_rating: number;
  google_review_count: number;
  owner_name: string;
  google_place_id: string;
  pain_score: number;
  pain_hook: string;
  pain_summary: string;
  email_subject: string;
  email_body: string;
  status: string;
}

async function readSheetData(token: string): Promise<SheetRow[]> {
  // Read the main data sheet — expected columns:
  // Business | Address | Phone | Website | Rating | ReviewCount | Owner | PlaceID | Pain_Score | Hook | Summary | Subject | Body | Status
  const range = encodeURIComponent('Sheet1!A2:N'); // Skip header row
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_ID}/values/${range}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets API failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const rows: SheetRow[] = (data.values || []).map((row: string[]) => ({
    business_name: row[0] || '',
    address: row[1] || '',
    phone: row[2] || '',
    website: row[3] || '',
    google_rating: parseFloat(row[4]) || 0,
    google_review_count: parseInt(row[5]) || 0,
    owner_name: row[6] || '',
    google_place_id: row[7] || '',
    pain_score: parseInt(row[8]) || 0,
    pain_hook: row[9] || '',
    pain_summary: row[10] || '',
    email_subject: row[11] || '',
    email_body: row[12] || '',
    status: row[13] || 'discovered',
  }));

  return rows.filter((r) => r.business_name && r.google_place_id);
}

// ── Determine Lead Status ──
function determineStatus(row: SheetRow): string {
  if (row.email_subject && row.email_body) return 'email_drafted';
  if (row.pain_score > 0) return 'researched';
  return 'discovered';
}

// ── Upsert Leads to Supabase ──
async function upsertLead(
  row: SheetRow,
  searchQuery: string,
  searchMode: 'cron' | 'manual'
): Promise<{ isNew: boolean; leadId: string | null; status: string }> {
  const status = determineStatus(row);
  const now = new Date().toISOString();

  // Build the upsert payload
  const leadData: Record<string, any> = {
    business_name: row.business_name,
    address: row.address || null,
    phone: row.phone || null,
    website: row.website || null,
    owner_name: row.owner_name || null,
    google_rating: row.google_rating || null,
    google_review_count: row.google_review_count || null,
    google_place_id: row.google_place_id,
    status,
    search_query: searchQuery,
    search_mode: searchMode,
    updated_at: now,
  };

  // Add Pluto data if present
  if (row.pain_score > 0) {
    leadData.pain_score = row.pain_score;
    leadData.pain_hook = row.pain_hook || null;
    leadData.pain_summary = row.pain_summary || null;
    leadData.researched_at = now;
  }

  // Add Emilio data if present
  if (row.email_subject && row.email_body) {
    leadData.email_subject = row.email_subject;
    leadData.email_body = row.email_body;
    leadData.email_drafted_at = now;
  }

  // Check if lead already exists
  const { data: existing } = await supabase
    .from('leads')
    .select('id, status')
    .eq('google_place_id', row.google_place_id)
    .single();

  if (existing) {
    // Update existing lead — don't overwrite if already further in pipeline
    const statusOrder = ['discovered', 'researched', 'email_drafted', 'email_sent', 'replied', 'qualified', 'disqualified'];
    const existingIdx = statusOrder.indexOf(existing.status);
    const newIdx = statusOrder.indexOf(status);

    if (newIdx > existingIdx) {
      // Only update if new status is further along
      const { error } = await supabase
        .from('leads')
        .update(leadData)
        .eq('id', existing.id);

      if (error) throw error;
    }

    return { isNew: false, leadId: existing.id, status };
  }

  // Insert new lead
  const { data: newLead, error } = await supabase
    .from('leads')
    .insert([leadData])
    .select('id')
    .single();

  if (error) throw error;

  return { isNew: true, leadId: newLead?.id || null, status };
}

// ── Create Mission for High-Value Leads ──
async function createMission(
  row: SheetRow,
  leadId: string
): Promise<string | null> {
  // Only create missions for email-drafted leads with pain_score >= 5
  if (!row.email_subject || !row.email_body || row.pain_score < 5) {
    return null;
  }

  // Check if mission already exists for this lead
  const { data: existingLead } = await supabase
    .from('leads')
    .select('mission_id')
    .eq('id', leadId)
    .single();

  if (existingLead?.mission_id) {
    return existingLead.mission_id; // Already has a mission
  }

  // Determine priority from pain score
  let priority: string;
  if (row.pain_score >= 8) priority = 'urgent';
  else if (row.pain_score >= 6) priority = 'high';
  else priority = 'normal';

  // Create mission
  const { data: mission, error: mErr } = await supabase
    .from('missions')
    .insert([
      {
        agent_id: 'emilio',
        status: 'needs_shuki',
        priority,
        title: `Cold email ready: ${row.business_name} (${row.pain_score}/10)`,
        description: `Hook: ${row.pain_hook}\n\nSubject: ${row.email_subject}\n\n${row.pain_summary}`,
        assigned_to: 'shuki',
      },
    ])
    .select()
    .single();

  if (mErr) throw mErr;

  // Link mission to lead
  await supabase
    .from('leads')
    .update({ mission_id: mission.id })
    .eq('id', leadId);

  return mission.id;
}

// ── Trigger n8n Webhook ──
async function triggerN8nPipeline(
  searchQuery: string,
  searchMode: 'cron' | 'manual'
): Promise<boolean> {
  if (!N8N_WEBHOOK_URL) {
    console.log('N8N_WEBHOOK_URL not set — skipping n8n trigger, reading Sheets directly');
    return false;
  }

  try {
    const res = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        search_query: searchQuery,
        search_mode: searchMode,
        triggered_by: 'emilio_cron',
        max_results: 50,
      }),
    });

    if (!res.ok) {
      console.warn(`n8n webhook returned ${res.status}`);
      return false;
    }

    console.log(`n8n webhook triggered for "${searchQuery}"`);
    return true;
  } catch (err: any) {
    console.error(`n8n webhook error: ${err.message}`);
    return false;
  }
}

// ── Telegram ──
async function sendTelegram(message: string) {
  if (!TELEGRAM_BOT_TOKEN) return;

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: SHUKI_TELEGRAM_ID,
        text: message,
        parse_mode: 'HTML',
      }),
    });
  } catch (err) {
    console.error('Telegram error:', err);
  }
}

// ── Agent Heartbeat ──
async function setAgentStatus(agentId: string, status: 'active' | 'idle') {
  await supabase
    .from('agents')
    .update({ status, last_heartbeat: new Date().toISOString() })
    .eq('id', agentId);
}

// ── Log Agent Activity ──
async function logActivity(
  agentId: string,
  activityType: string,
  message: string,
  severity: 'info' | 'warning' | 'error' = 'info'
) {
  await supabase.from('agent_activity').insert([
    {
      agent_id: agentId,
      activity_type: activityType,
      message,
      severity,
    },
  ]);
}

// ══════════════════════════════════════════════════
// MAIN EMILIO PIPELINE CRON HANDLER
// ══════════════════════════════════════════════════
export async function GET(request: Request) {
  // ── Auth ──
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  console.log('Emilio Pipeline: Starting cron cycle...');

  // ── Heartbeats: mark all pipeline agents active ──
  await Promise.all([
    setAgentStatus('midas', 'active'),
    setAgentStatus('pluto', 'active'),
    setAgentStatus('emilio', 'active'),
  ]);

  // Pick search query — rotate based on hour of day
  const hour = new Date().getUTCHours();
  const queryIndex = Math.floor(hour / 4) % CRON_SEARCH_QUERIES.length;
  const searchQuery = CRON_SEARCH_QUERIES[queryIndex];

  // Check for manual trigger via query params
  const url = new URL(request.url);
  const manualQuery = url.searchParams.get('query');
  const activeQuery = manualQuery || searchQuery;
  const searchMode: 'cron' | 'manual' = manualQuery ? 'manual' : 'cron';

  let newLeads = 0;
  let updatedLeads = 0;
  let missionsCreated = 0;
  let emailsDrafted = 0;
  let highPainCount = 0;
  let errors = 0;

  try {
    // ── Step 1: Trigger n8n pipeline (if webhook configured) ──
    console.log(`  Search query: "${activeQuery}" (${searchMode})`);
    const n8nTriggered = await triggerN8nPipeline(activeQuery, searchMode);

    if (n8nTriggered) {
      // Wait for n8n to process — Midas scrapes, Pluto analyzes, Emilio writes
      // n8n typically takes 2-5 minutes for full pipeline
      console.log('  Waiting 180s for n8n pipeline to complete...');
      await new Promise((r) => setTimeout(r, 180000)); // 3 minutes
    }

    // ── Step 2: Read results from Google Sheets ──
    console.log('  Reading Google Sheets results...');
    let googleToken: string;
    try {
      googleToken = await getGoogleAccessToken();
    } catch (authErr: any) {
      console.error('  Google auth failed:', authErr.message);
      // If Google auth fails, try to read any un-synced data from previous runs
      throw new Error(`Google Sheets auth failed: ${authErr.message}`);
    }

    const sheetRows = await readSheetData(googleToken);
    console.log(`  Found ${sheetRows.length} rows in Sheets`);

    if (sheetRows.length === 0) {
      console.log('  No data in Sheets — ending cycle');
      await sendTelegram(`📧 Emilio Pipeline: No leads found for "${activeQuery}"`);
      await Promise.all([
        setAgentStatus('midas', 'idle'),
        setAgentStatus('pluto', 'idle'),
        setAgentStatus('emilio', 'idle'),
      ]);
      return new Response(
        JSON.stringify({ success: true, message: 'No leads found', query: activeQuery }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── Step 3: Upsert each lead to Supabase ──
    for (const row of sheetRows) {
      try {
        const result = await upsertLead(row, activeQuery, searchMode);

        if (result.isNew) newLeads++;
        else updatedLeads++;

        if (result.status === 'email_drafted') emailsDrafted++;
        if (row.pain_score >= 7) highPainCount++;

        // ── Step 4: Create missions for high-value leads ──
        if (result.leadId) {
          const missionId = await createMission(row, result.leadId);
          if (missionId) missionsCreated++;
        }
      } catch (rowErr: any) {
        console.error(`  Error processing ${row.business_name}:`, rowErr.message);
        errors++;
      }
    }

    console.log(
      `  Pipeline complete: ${newLeads} new, ${updatedLeads} updated, ${emailsDrafted} emails, ${missionsCreated} missions, ${errors} errors`
    );

    // ── Step 5: Telegram Summary ──
    await sendTelegram(
      `📧 <b>Emilio Pipeline Complete</b>\n\n` +
        `🔍 Search: "${activeQuery}"\n` +
        `📊 Leads: ${newLeads} new, ${updatedLeads} updated\n` +
        `🧠 Analyzed: ${sheetRows.filter((r) => r.pain_score > 0).length} (Pluto)\n` +
        `✉️ Emails drafted: ${emailsDrafted} (Emilio)\n` +
        `🔥 High pain (≥7): ${highPainCount}\n` +
        `📋 Missions created: ${missionsCreated}\n` +
        (errors > 0 ? `⚠️ Errors: ${errors}\n` : '') +
        `\nReview at Mission Control →`
    );

    // ── Step 6: Log Activity ──
    await logActivity(
      'midas',
      'search_completed',
      `Search "${activeQuery}": ${newLeads + updatedLeads} leads found (${newLeads} new)`,
      'info'
    );
    await logActivity(
      'pluto',
      'analysis_completed',
      `Analyzed ${sheetRows.filter((r) => r.pain_score > 0).length} leads, avg pain: ${
        sheetRows.filter((r) => r.pain_score > 0).length > 0
          ? (
              sheetRows.filter((r) => r.pain_score > 0).reduce((s, r) => s + r.pain_score, 0) /
              sheetRows.filter((r) => r.pain_score > 0).length
            ).toFixed(1)
          : 'N/A'
      }`,
      'info'
    );
    await logActivity(
      'emilio',
      'pipeline_completed',
      `Drafted ${emailsDrafted} emails, created ${missionsCreated} missions. High pain: ${highPainCount}`,
      'info'
    );
  } catch (error: any) {
    console.error('Emilio Pipeline fatal error:', error);
    await sendTelegram(`❌ Emilio Pipeline error: ${error.message}`);
    await logActivity('emilio', 'error', `Fatal: ${error.message}`, 'error');
    errors++;
  }

  // ── Heartbeats: mark all idle ──
  await Promise.all([
    setAgentStatus('midas', 'idle'),
    setAgentStatus('pluto', 'idle'),
    setAgentStatus('emilio', 'idle'),
  ]);

  return new Response(
    JSON.stringify({
      success: true,
      query: activeQuery,
      mode: searchMode,
      newLeads,
      updatedLeads,
      emailsDrafted,
      missionsCreated,
      highPainCount,
      errors,
      timestamp: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
