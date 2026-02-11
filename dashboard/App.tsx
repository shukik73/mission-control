import React, { useState, useEffect } from 'react';
import { AgentSidebar } from './components/AgentSidebar';
import { DealCard } from './components/DealCard';
import { DealStatus, Priority, StreamType, Deal } from './types';
import { MOCK_AGENTS, MOCK_DEALS } from './constants';
import { LayoutDashboard, Settings, Bell, Search, AlertCircle, Rocket, DollarSign, BarChart2, Sun, Moon } from 'lucide-react';

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

  // Toggle Dark Mode
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const columns = [
    { id: DealStatus.Inbox, title: streamFilter === 'saas' ? 'SaaS Inbox' : 'Scout Inbox' },
    { id: DealStatus.Review, title: 'Under Review' },
    { id: DealStatus.NeedsShuki, title: 'Needs Shuki' },
    { id: DealStatus.Done, title: 'Done' },
  ];

  // --- FILTERING LOGIC ---
  const filterDeal = (deal: Deal): boolean => {
    // 1. Stream Filter
    if (streamFilter !== 'all' && deal.stream !== streamFilter) return false;

    // 2. Auto-Pass Logic (Crucial Update)
    // Skip auto-pass for reports/internal items with no cost
    if (deal.stream === 'deal' && (deal.cost > 0 || deal.shipping > 0)) {
        const totalCost = deal.cost + deal.shipping;
        const profit = deal.marketValue - totalCost;
        const roi = totalCost > 0 ? (profit / totalCost) * 100 : 0;

        // Rule 1: Auto-pass ROI < 20%
        if (roi < 20) return false;

        // Rule 2: Non-electronics < 100% ROI -> Auto-pass
        if (deal.category !== 'electronics' && roi < 100) return false;
    }

    return true;
  };

  const getFilteredDeals = (status: DealStatus) => {
    return MOCK_DEALS.filter(d => d.status === status && filterDeal(d));
  };

  return (
    <div className="flex h-screen bg-background font-sans overflow-hidden transition-colors duration-300">
      {/* Sidebar */}
      <AgentSidebar agents={MOCK_AGENTS} />

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
                <p className="text-xs text-secondary mt-1">Operational Dashboard v3.0</p>
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
                            <DealCard key={deal.id} deal={deal} />
                        ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      </div>
    </div>
  );
}