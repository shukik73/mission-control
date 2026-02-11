import { supabase, isLive } from './supabase';
import { Deal, DealStatus, Priority, Agent } from '../types';
import { MOCK_AGENTS, MOCK_DEALS } from '../constants';

// ── Map DB rows → frontend types ────────────────────────────

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
  auction_ends_at: string | null;
  status: string;
  rejection_reason: string | null;
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
    localPickup: row.is_local_pickup,
    status: mapMissionStatus(missionStatus, row.status),
    priority: mapPriority(missionPriority),
    category: (row.item_type === 'electronics' || !row.item_type) ? 'electronics' : 'other',
    stream: 'deal',
  };
}

interface AgentRow {
  id: string;
  name: string;
  status: string;
  last_heartbeat: string | null;
  metadata: Record<string, unknown>;
}

function rowToAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    status: row.status === 'active' ? 'active' : row.status === 'idle' ? 'waiting' : 'paused',
    lastActive: row.last_heartbeat ? new Date(row.last_heartbeat) : new Date(),
    dealsFound: 0,
    dealsPending: 0,
    currentStream: String((row.metadata as Record<string, unknown>)?.stream ?? 'Techy Miramar'),
  };
}

// ── Public API ───────────────────────────────────────────────

export async function fetchDeals(): Promise<Deal[]> {
  if (!isLive || !supabase) return MOCK_DEALS;

  const { data, error } = await supabase
    .from('scout_deals')
    .select(`
      *,
      missions!scout_deals_mission_id_fkey ( status, priority )
    `)
    .order('created_at', { ascending: false });

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
    .neq('id', 'shuki');  // don't show human operator

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

  const { error } = await supabase
    .from('scout_deals')
    .update({
      status: 'approved',
      decision_made_at: new Date().toISOString(),
    })
    .eq('id', dealId);

  if (error) {
    console.error('approveDeal error:', error);
    return false;
  }

  // Also update linked mission status to 'done'
  const { data: deal } = await supabase
    .from('scout_deals')
    .select('mission_id')
    .eq('id', dealId)
    .single();

  if (deal?.mission_id) {
    await supabase
      .from('missions')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', deal.mission_id);
  }

  return true;
}

export async function rejectDeal(dealId: string, reason?: string): Promise<boolean> {
  if (!isLive || !supabase) {
    console.log('[Demo] Reject deal:', dealId, reason);
    return true;
  }

  const { error } = await supabase
    .from('scout_deals')
    .update({
      status: 'rejected',
      rejection_reason: reason || 'Passed by Shuki',
      decision_made_at: new Date().toISOString(),
    })
    .eq('id', dealId);

  if (error) {
    console.error('rejectDeal error:', error);
    return false;
  }

  // Also update linked mission
  const { data: deal } = await supabase
    .from('scout_deals')
    .select('mission_id')
    .eq('id', dealId)
    .single();

  if (deal?.mission_id) {
    await supabase
      .from('missions')
      .update({ status: 'rejected' })
      .eq('id', deal.mission_id);
  }

  return true;
}

/** Subscribe to real-time scout_deals changes */
export function subscribeToDeals(onUpdate: () => void) {
  if (!isLive || !supabase) return () => {};

  const channel = supabase
    .channel('scout-deals-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'scout_deals' },
      () => onUpdate()
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}
