import React, { useState, useEffect, useCallback } from 'react';
import { AgentSidebar } from './components/AgentSidebar';
import { DealCard } from './components/DealCard';
import { DealStatus, Priority, StreamType, Deal, Agent } from './types';
import { MOCK_AGENTS, MOCK_DEALS } from './constants';
import { fetchDeals, fetchAgents, approveDeal, rejectDeal, askJay, subscribeToDeals } from './lib/api';
import { isLive } from './lib/supabase';
import { quickROI } from './lib/roi';
import { LayoutDashboard, Settings, Bell, Search, AlertCircle, Rocket, DollarSign, BarChart2, Sun, Moon, Wifi, WifiOff } from 'lucide-react';

const ColumnHeader: React.FC<{ title: string; count: number; status: DealStatus }> = ({ title, count, status }) => {
  const isNeedsShuki = status === DealStatus.NeedsShuki;

  return (
    <div className={`flex items-center justify-between mb-4 pb-2 border-b ${isNeedsShuki ? 'border-rose-500/50' : 'border-border'}`}>
      <h3 className={`font-bold tracking-wide text-sm flex items-center ${isNeedsShuki ? 'text-rose-500' : 'text-secondary'}`}>
        {isNeedsShuki && <AlertCircle size={16} className="mr-2 animate-pulse" />}
        {title.toUpperCase()}
      </h3>
      <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${
        isNeedsShuki
            ? 'bg-rose-500 text-white'
            : 'bg-surfaceHighlight text-secondary'
      }`}>
        {count}
      </span>
    </div>
  );
};

export default function App() {
  const [streamFilter, setStreamFilter] = useState<'all' | 'deal' | 'saas'>('all');
  const [darkMode, setDarkMode] = useState(true);
  const [deals, setDeals] = useState<Deal[]>(isLive ? [] : MOCK_DEALS);
  const [agents, setAgents] = useState<Agent[]>(isLive ? [] : MOCK_AGENTS);
  const [loading, setLoading] = useState(true);

  // Toggle Dark Mode
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Load data from Supabase (or fall back to mocks)
  const loadData = useCallback(async () => {
    try {
      const [liveDeals, liveAgents] = await Promise.all([fetchDeals(), fetchAgents()]);
      setDeals(liveDeals);
      setAgents(liveAgents);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Real-time subscription — debounced to avoid rapid-fire refetches
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout>;
    const unsub = subscribeToDeals(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => loadData(), 500);
    });
    return () => {
      clearTimeout(debounceTimer);
      unsub();
    };
  }, [loadData]);

  // ── Deal Actions ──
  const handleApprove = useCallback(async (dealId: string) => {
    const ok = await approveDeal(dealId);
    if (ok) {
      // Optimistic update: move deal to Done
      setDeals(prev => prev.map(d =>
        d.id === dealId ? { ...d, status: DealStatus.Done } : d
      ));
    }
  }, []);

  const handlePass = useCallback(async (dealId: string) => {
    const ok = await rejectDeal(dealId, 'Passed by Shuki');
    if (ok) {
      setDeals(prev => prev.map(d =>
        d.id === dealId ? { ...d, status: DealStatus.Done } : d
      ));
    }
  }, []);

  const handleAskJay = useCallback(async (dealId: string) => {
    await askJay(dealId);
  }, []);

  const columns = [
    { id: DealStatus.Inbox, title: streamFilter === 'saas' ? 'SaaS Inbox' : 'Scout Inbox' },
    { id: DealStatus.Review, title: 'Under Review' },
    { id: DealStatus.NeedsShuki, title: 'Needs Shuki' },
    { id: DealStatus.Done, title: 'Done' },
  ];

  // --- FILTERING LOGIC (uses unified ROI with platform fees) ---
  const filterDeal = (deal: Deal): boolean => {
    // 1. Stream Filter
    if (streamFilter !== 'all' && deal.stream !== streamFilter) return false;

    // 2. Auto-Pass Logic — uses fee-adjusted ROI from unified calculator
    // Skip auto-pass for reports/internal items with no cost
    if (deal.stream === 'deal' && (deal.cost > 0 || deal.shipping > 0)) {
        const roi = quickROI(deal.cost, deal.shipping, deal.marketValue);

        // Rule 1: Auto-pass ROI < 20% (after fees)
        if (roi < 20) return false;

        // Rule 2: Non-electronics < 100% ROI -> Auto-pass
        if (deal.category !== 'electronics' && roi < 100) return false;
    }

    return true;
  };

  const getFilteredDeals = (status: DealStatus) => {
    return deals.filter(d => d.status === status && filterDeal(d));
  };

  return (
    <div className="flex h-screen bg-background font-sans overflow-hidden transition-colors duration-300">
      {/* Sidebar */}
      <AgentSidebar agents={agents} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Navbar */}
        <header className="h-16 border-b border-border bg-surface flex items-center justify-between px-6 shrink-0 z-20">
          <div className="flex items-center">
             <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-2 rounded-lg mr-3 shadow-lg shadow-indigo-500/20">
                <LayoutDashboard className="text-white" size={20} />
             </div>
             <div>
                <h1 className="text-primary font-bold text-lg leading-none">Mission Control</h1>
                <p className="text-xs text-secondary mt-1 flex items-center gap-1.5">
                  Operational Dashboard v3.0
                  {isLive ? (
                    <span className="inline-flex items-center gap-1 text-emerald-500" title="Connected to Supabase">
                      <Wifi size={10} />
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-yellow-500" title="Demo mode — no Supabase connection">
                      <WifiOff size={10} /> demo
                    </span>
                  )}
                </p>
             </div>
          </div>

          {/* Stream Selector */}
          <div className="flex bg-surfaceHighlight rounded-lg p-1 mx-4 space-x-1 border border-border">
            <button
                onClick={() => setStreamFilter('deal')}
                className={`flex items-center px-3 py-1.5 rounded-md text-xs font-bold transition-all ${streamFilter === 'deal' ? 'bg-surface text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}>
                <DollarSign size={14} className="mr-1.5" /> Scout Deals
            </button>
            <button
                onClick={() => setStreamFilter('saas')}
                className={`flex items-center px-3 py-1.5 rounded-md text-xs font-bold transition-all ${streamFilter === 'saas' ? 'bg-surface text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}>
                <Rocket size={14} className="mr-1.5" /> SaaS Ops
            </button>
            <button
                onClick={() => setStreamFilter('all')}
                className={`flex items-center px-3 py-1.5 rounded-md text-xs font-bold transition-all ${streamFilter === 'all' ? 'bg-surface text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}>
                <BarChart2 size={14} className="mr-1.5" /> All Streams
            </button>
          </div>

          <div className="flex items-center space-x-4">
            <div className="relative hidden md:block">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" size={16} />
                <input
                    type="text"
                    placeholder="Search missions..."
                    className="bg-surfaceHighlight border border-border rounded-full pl-10 pr-4 py-1.5 text-sm text-primary focus:outline-none focus:border-accent w-56 transition-all placeholder:text-zinc-500"
                />
            </div>

            <button
                onClick={() => setDarkMode(!darkMode)}
                className="text-secondary hover:text-primary transition-colors p-1.5 rounded-lg hover:bg-surfaceHighlight">
                {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>

            <button className="text-secondary hover:text-primary transition-colors relative">
                <Bell size={20} />
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-background"></span>
            </button>
            <button className="text-secondary hover:text-primary transition-colors">
                <Settings size={20} />
            </button>
            <div className="w-8 h-8 bg-surfaceHighlight rounded-full flex items-center justify-center border border-border">
                <span className="font-bold text-xs text-primary">SK</span>
            </div>
          </div>
        </header>

        {/* Kanban Board */}
        <main className="flex-1 overflow-x-auto overflow-y-hidden p-6 bg-background">
          {loading ? (
            <div className="flex items-center justify-center h-full text-secondary">
              <div className="animate-spin w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full mr-3" />
              Loading missions...
            </div>
          ) : (
            <div className="flex h-full space-x-6 min-w-max">
              {columns.map(column => {
                const columnDeals = getFilteredDeals(column.id as DealStatus);

                // Dynamic widths
                const widthClass = column.id === DealStatus.NeedsShuki ? 'w-96' : 'w-80';
                const bgClass = column.id === DealStatus.NeedsShuki ? 'bg-rose-500/5 border border-rose-500/10' : 'bg-transparent';

                return (
                  <div key={column.id} className={`flex flex-col h-full ${widthClass} ${bgClass} rounded-xl transition-all p-1`}>
                    <ColumnHeader title={column.title} count={columnDeals.length} status={column.id as DealStatus} />

                    <div className="flex-1 overflow-y-auto pr-2 pb-10 scrollbar-thin">
                      {columnDeals.length === 0 ? (
                          <div className="h-32 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center text-secondary text-sm italic opacity-60">
                              <span>All caught up</span>
                              <span className="text-xs mt-1">No items in {streamFilter} stream</span>
                          </div>
                      ) : (
                          columnDeals.map(deal => (
                              <DealCard
                                key={deal.id}
                                deal={deal}
                                onApprove={handleApprove}
                                onPass={handlePass}
                                onAskJay={handleAskJay}
                              />
                          ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
