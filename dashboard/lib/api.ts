import { supabase, isLive } from './supabase';
import { Deal, DealStatus, Priority, Agent } from '../types';
import { MOCK_AGENTS, MOCK_DEALS } from '../constants';

// ── Map DB rows -> frontend types ────────────────────────────

function mapMissionStatus(missionStatus: string, dealStatus: string): DealStatus {
  // scout_deals.status takes priority for final states
  if (dealStatus === 'approved' || dealStatus === 'purchased') return DealStatus.Done;
  if (dealStatus === 'rejected') return DealStatus.Done;

  // missions.status for pipeline stages
  switch (missionStatus) {
    case 'inbox':
    case 'assigned':
      return DealStatus.Inbox;
    case 'active':
    case 'review':
      return DealStatus.Review;
    case 'needs_shuki':
      return DealStatus.NeedsShuki;
    case 'done':
    case 'rejected':
      return DealStatus.Done;
    default:
      return DealStatus.Inbox;
  }
}

function mapPriority(p: string | null): Priority | undefined {
  switch (p) {
    case 'urgent': return Priority.Urgent;
    case 'high': return Priority.High;
    case 'normal': return Priority.Normal;
    default: return undefined;
  }
}

interface ScoutDealRow {
  id: string;
  title: string;
  platform: string;
  location: string | null;
  price: number;
  shipping_cost: number;
  estimated_value: number;
  seller_rating: number | null;
  seller_feedback_count: number | null;
  is_local_pickup: boolean;
  distance_miles: number | null;
  auction_ends_at: string | null;
  status: string;
  rejection_reason: string | null;
  item_url: string | null;
  item_type: string | null;
  created_at: string;
  mission_id: string | null;
  missions: {
    status: string;
    priority: string | null;
  } | null;
}

function rowToDeal(row: ScoutDealRow): Deal {
  const missionStatus = row.missions?.status ?? 'inbox';
  const missionPriority = row.missions?.priority ?? null;

  return {
    id: row.id,
    title: row.title,
    source: row.platform || 'Unknown',
    location: row.location || 'Unknown',
    endsAt: row.auction_ends_at ? new Date(row.auction_ends_at) : new Date(Date.now() + 7 * 86400000),
    cost: Number(row.price) || 0,
    shipping: Number(row.shipping_cost) || 0,
    marketValue: Number(row.estimated_value) || 0,
    sellerRating: Number(row.seller_rating) || 0,
    sellerSales: Number(row.seller_feedback_count) || 0,
    itemUrl: row.item_url || undefined,
    localPickup: row.is_local_pickup,
    distanceMiles: row.distance_miles ? Number(row.distance_miles) : undefined,
    status: mapMissionStatus(missionStatus, row.status),
    priority: mapPriority(missionPriority),
    category: (row.item_type === 'electronics' || !row.item_type) ? 'electronics' : 'other',
    stream: 'deal',
  };
}

interface AgentRow {
  id: string;
  name: string;
  role: string;
  status: string;
  last_heartbeat: string | null;
  metadata: Record<string, unknown>;
}

function rowToAgent(row: AgentRow): Agent {
  // Agents with no heartbeat have never run — treat as paused
  const hasHeartbeat = !!row.last_heartbeat;
  let status: 'active' | 'waiting' | 'paused';
  if (!hasHeartbeat) {
    status = 'paused';
  } else if (row.status === 'active') {
    status = 'active';
  } else if (row.status === 'idle') {
    status = 'waiting';
  } else {
    status = 'paused';
  }

  return {
    id: row.id,
    name: row.name,
    role: row.role || '',
    status,
    lastActive: row.last_heartbeat ? new Date(row.last_heartbeat) : new Date(0), // epoch = never
    dealsFound: 0,
    dealsPending: 0,
    currentStream: String((row.metadata as Record<string, unknown>)?.stream ?? 'Techy Miramar'),
  };
}

// ── Public API ───────────────────────────────────────────────

const PAGE_SIZE = 100;

export async function fetchDeals(page = 0): Promise<Deal[]> {
  if (!isLive || !supabase) return MOCK_DEALS;

  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, error } = await supabase
    .from('scout_deals')
    .select(`
      *,
      missions!scout_deals_mission_id_fkey ( status, priority )
    `)
    .neq('status', 'rejected')  // don't load rejected deals by default
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    console.error('fetchDeals error:', error);
    return MOCK_DEALS;  // graceful fallback
  }

  return (data ?? []).map(rowToDeal);
}

export async function fetchAgents(): Promise<Agent[]> {
  if (!isLive || !supabase) return MOCK_AGENTS;

  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .neq('id', 'shuki')  // don't show human operator
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('fetchAgents error:', error);
    return MOCK_AGENTS;
  }

  return (data ?? []).map(rowToAgent);
}

export async function approveDeal(dealId: string): Promise<boolean> {
  if (!isLive || !supabase) {
    console.log('[Demo] Approve deal:', dealId);
    return true;
  }

  // Race condition guard: only update if still pending
  const { data: updated, error } = await supabase
    .from('scout_deals')
    .update({
      status: 'approved',
      decision_made_at: new Date().toISOString(),
    })
    .eq('id', dealId)
    .eq('status', 'pending')  // guard: only if still pending
    .select('id, mission_id')
    .single();

  if (error || !updated) {
    console.error('approveDeal error (possibly already actioned):', error);
    return false;
  }

  // Update linked mission — if this fails, deal is still marked approved (acceptable)
  if (updated.mission_id) {
    const { error: mErr } = await supabase
      .from('missions')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', updated.mission_id);

    if (mErr) {
      console.error('approveDeal: mission update failed (deal still approved):', mErr);
    }
  }

  // Audit log
  await supabase.from('deal_audit_log').insert({
    deal_id: dealId,
    mission_id: updated.mission_id,
    action: 'approved',
    source: 'dashboard',
    performed_by: (await supabase.auth.getUser()).data.user?.email || 'unknown',
  }).then(({ error: auditErr }) => {
    if (auditErr) console.error('Audit log insert failed:', auditErr);
  });

  return true;
}

export async function rejectDeal(dealId: string, reason?: string): Promise<boolean> {
  if (!isLive || !supabase) {
    console.log('[Demo] Reject deal:', dealId, reason);
    return true;
  }

  // Race condition guard: only update if still pending
  const { data: updated, error } = await supabase
    .from('scout_deals')
    .update({
      status: 'rejected',
      rejection_reason: reason || 'Passed by Shuki',
      decision_made_at: new Date().toISOString(),
    })
    .eq('id', dealId)
    .eq('status', 'pending')  // guard: only if still pending
    .select('id, mission_id')
    .single();

  if (error || !updated) {
    console.error('rejectDeal error (possibly already actioned):', error);
    return false;
  }

  // Update linked mission
  if (updated.mission_id) {
    const { error: mErr } = await supabase
      .from('missions')
      .update({ status: 'rejected' })
      .eq('id', updated.mission_id);

    if (mErr) {
      console.error('rejectDeal: mission update failed:', mErr);
    }
  }

  // Audit log
  await supabase.from('deal_audit_log').insert({
    deal_id: dealId,
    mission_id: updated.mission_id,
    action: 'rejected',
    source: 'dashboard',
    reason: reason || 'Passed by Shuki',
    performed_by: (await supabase.auth.getUser()).data.user?.email || 'unknown',
  }).then(({ error: auditErr }) => {
    if (auditErr) console.error('Audit log insert failed:', auditErr);
  });

  return true;
}

/** Ask Jay to review a deal — creates a sub-mission for Jay */
export async function askJay(dealId: string): Promise<boolean> {
  if (!isLive || !supabase) {
    console.log('[Demo] Ask Jay:', dealId);
    return true;
  }

  // Get the scout deal + linked mission
  const { data: deal, error: fetchErr } = await supabase
    .from('scout_deals')
    .select('id, title, mission_id, price, shipping_cost, estimated_value, roi_percent')
    .eq('id', dealId)
    .single();

  if (fetchErr || !deal) {
    console.error('askJay: deal not found:', fetchErr);
    return false;
  }

  // Create a review mission for Jay
  const { error: insertErr } = await supabase
    .from('missions')
    .insert({
      agent_id: 'jay',
      status: 'assigned',
      priority: 'normal',
      title: `Review & Advise: ${deal.title?.substring(0, 60)}`,
      description: `Shuki wants your analysis. Price: $${deal.price}, Value: $${deal.estimated_value}, ROI: ${deal.roi_percent}%`,
      assigned_to: 'jay',
      metadata: {
        parent_deal_id: dealId,
        parent_mission_id: deal.mission_id,
        review_type: 'shuki_asked_jay',
      },
    });

  if (insertErr) {
    console.error('askJay: mission insert failed:', insertErr);
    return false;
  }

  return true;
}

/** Subscribe to real-time scout_deals changes — uses incremental updates */
export function subscribeToDeals(onUpdate: (payload: any) => void) {
  if (!isLive || !supabase) return () => {};

  const channel = supabase
    .channel('scout-deals-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'scout_deals' },
      (payload) => onUpdate(payload)
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}
