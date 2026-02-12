import React, { useState, useEffect } from 'react';
import { Clock, MapPin, TrendingUp, DollarSign, Package, UserCheck, MessageSquare, ThumbsUp, ThumbsDown, AlertTriangle, AlertCircle, Car, HelpCircle, FileText, Loader2, Check, X } from 'lucide-react';
import { Deal, Priority } from '../types';
import { calculateROI } from '../lib/roi';
import { formatDistanceToNow } from 'date-fns';

interface DealCardProps {
  deal: Deal;
  onApprove?: (id: string) => Promise<void> | void;
  onPass?: (id: string) => Promise<void> | void;
}

export const DealCard: React.FC<DealCardProps> = ({ deal, onApprove, onPass }) => {
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [isUrgentTime, setIsUrgentTime] = useState(false);
  const [actionLoading, setActionLoading] = useState<'approve' | 'pass' | null>(null);
  const [actionDone, setActionDone] = useState<'approved' | 'passed' | null>(null);

  // --- Local Pickup Economics ---
  let pickupCost = 0;
  let pickupDetails = null;
  if (deal.localPickup && deal.distanceMiles) {
    const gasCost = (deal.distanceMiles / 25) * 3.50; // $3.50/gal, 25mpg
    const timeCost = (deal.distanceMiles / 30) * 50;  // $50/hr opportunity cost
    pickupCost = gasCost + timeCost;
    pickupDetails = { gas: gasCost, time: timeCost };
  }

  // --- ROI Calculations (unified, includes platform fees) ---
  const isSaaS = deal.stream === 'saas' || deal.title.includes('Report');
  const roiResult = calculateROI({
    cost: deal.cost,
    shipping: deal.shipping,
    pickupCost,
    marketValue: deal.marketValue,
  });
  const { totalCost, profit, roi, platformFees } = roiResult;

  // --- Visual Logic ---
  let borderColorClass = 'border-l-zinc-700 dark:border-l-zinc-700';
  let roiColorClass = 'text-rose-500';

  if (!isSaaS) {
    if (roi > 100) {
        borderColorClass = 'border-l-emerald-500';
        roiColorClass = 'text-emerald-500';
    } else if (roi >= 50) {
        borderColorClass = 'border-l-yellow-500';
        roiColorClass = 'text-yellow-500';
    } else {
        borderColorClass = 'border-l-rose-500';
        roiColorClass = 'text-rose-500';
    }
  } else {
    borderColorClass = 'border-l-indigo-500';
    roiColorClass = 'text-indigo-400';
  }

  // Category Validation Flag
  const needsCategoryCheck = deal.category !== 'electronics' && roi > 100 && !isSaaS;

  // Urgent styling
  const isUrgentPriority = deal.priority === Priority.Urgent;

  // Urgent Auction Alert (< 1 hour AND > 50% ROI)
  const isUrgentAuction = isUrgentTime && roi > 50 && !isSaaS;

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const diff = deal.endsAt.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeLeft('Ended');
        setIsUrgentTime(false);
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      setIsUrgentTime(hours < 1);
      setTimeLeft(`${hours}h ${minutes}m`);
    };

    updateTime();
    const interval = setInterval(updateTime, 60000);
    return () => clearInterval(interval);
  }, [deal.endsAt]);

  // ── Action handlers ──
  const handleApprove = async () => {
    if (actionLoading || actionDone) return;
    setActionLoading('approve');
    try {
      await onApprove?.(deal.id);
      setActionDone('approved');
    } catch {
      setActionLoading(null);
    }
  };

  const handlePass = async () => {
    if (actionLoading || actionDone) return;
    setActionLoading('pass');
    try {
      await onPass?.(deal.id);
      setActionDone('passed');
    } catch {
      setActionLoading(null);
    }
  };

  const cardBaseClasses = `
    relative bg-surface hover:bg-surfaceHighlight
    border border-border
    rounded-r-lg shadow-sm mb-4
    transition-all duration-200 ease-out
    group overflow-hidden
  `;

  const urgencyAnimation = isUrgentAuction ? 'animate-pulse ring-2 ring-rose-500/50' : '';
  const doneOverlay = actionDone ? 'opacity-60' : '';

  return (
    <div className={`${cardBaseClasses} ${borderColorClass} ${urgencyAnimation} ${doneOverlay}`} style={{ borderLeftWidth: '4px' }}>
      <div className="p-4">
        {/* Action done badge */}
        {actionDone && (
          <div className={`absolute top-2 right-2 text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1 ${
            actionDone === 'approved'
              ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/50'
              : 'bg-zinc-500/20 text-zinc-400 border border-zinc-500/50'
          }`}>
            {actionDone === 'approved' ? <Check size={10} /> : <X size={10} />}
            {actionDone === 'approved' ? 'Approved' : 'Passed'}
          </div>
        )}

        {/* Priority / Category Badges */}
        <div className="flex flex-wrap gap-2 mb-2">
            {deal.priority && (
                <div className={`inline-flex items-center text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                    isUrgentPriority ? 'bg-rose-500/20 text-rose-500 dark:text-rose-400 border border-rose-500/50' : 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border border-yellow-500/50'
                }`}>
                    {isUrgentPriority ? <AlertCircle size={12} className="mr-1" /> : <AlertTriangle size={12} className="mr-1" />}
                    {deal.priority}
                </div>
            )}
            {needsCategoryCheck && (
                <div className="inline-flex items-center text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/50">
                    <HelpCircle size={12} className="mr-1" />
                    Cat Check
                </div>
            )}
            {isUrgentAuction && (
                <div className="inline-flex items-center text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-red-600 text-white animate-bounce">
                    🚨 ENDING SOON
                </div>
            )}
        </div>

        <h3 className="text-primary font-semibold text-sm leading-snug mb-2 group-hover:text-blue-500 transition-colors">
          {deal.title}
        </h3>

        <div className="flex items-center text-xs text-secondary space-x-3 mb-3">
          <span className="bg-surfaceHighlight border border-border px-1.5 py-0.5 rounded font-medium">{deal.source}</span>
          <span className={`flex items-center ${isUrgentTime ? 'text-rose-500 font-bold' : ''}`}>
            <Clock size={12} className="mr-1" /> {timeLeft}
          </span>
          <span className="flex items-center truncate max-w-[100px]">
            <MapPin size={12} className="mr-1" /> {deal.location}
          </span>
        </div>

        {/* Financial Grid */}
        {!isSaaS && (
            <div className="grid grid-cols-2 gap-2 bg-background/50 rounded-lg p-2 mb-3 border border-border">
                <div className="space-y-1">
                    <div className="text-xs text-secondary">Breakdown</div>
                    <div className="text-sm font-mono text-primary">
                        ${deal.cost} <span className="text-secondary">+</span> ${deal.shipping}
                    </div>
                    {pickupCost > 0 && (
                        <div className="text-[10px] text-orange-400 flex items-center" title={`Gas: $${pickupDetails?.gas.toFixed(1)}, Time: $${pickupDetails?.time.toFixed(1)}`}>
                            <Car size={10} className="mr-1" />
                            +${pickupCost.toFixed(0)} Pickup ({deal.distanceMiles}mi)
                        </div>
                    )}
                    <div className="text-xs font-bold text-primary border-t border-border pt-1 mt-1">
                        = ${totalCost.toFixed(0)} Total
                    </div>
                </div>
                <div className="space-y-1 pl-2 border-l border-border">
                    <div className="text-xs text-secondary">Analysis</div>
                    <div className="text-xs text-secondary">Val: ${deal.marketValue}</div>
                    <div className="text-[10px] text-zinc-500">Fees: -${platformFees.toFixed(0)}</div>
                    <div className={`text-sm font-bold flex items-center ${roiColorClass}`}>
                        {Math.round(roi)}% ROI
                    </div>
                    <div className="text-xs text-emerald-600 dark:text-emerald-500 font-mono">
                    +${Math.round(profit)} Net
                    </div>
                </div>
            </div>
        )}

        {/* Logic for Report/SaaS Display */}
        {isSaaS && deal.marketValue > 0 && (
             <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-2 mb-3">
                 <div className="text-xs text-indigo-400">Value at risk</div>
                 <div className="font-mono font-bold text-indigo-300">${deal.marketValue}</div>
             </div>
        )}

        {/* Verification Badges */}
        <div className="space-y-1.5 mb-4">
            {!isSaaS && (
                <div className="flex items-center text-xs text-secondary">
                    <UserCheck size={12} className="mr-1.5 text-emerald-500" />
                    <span>Seller {deal.sellerRating}% ({deal.sellerSales.toLocaleString()})</span>
                </div>
            )}
            {deal.localPickup && (
                <div className="flex items-center text-xs text-secondary">
                    <Package size={12} className="mr-1.5 text-emerald-500" />
                    <span>Local pickup available</span>
                </div>
            )}
        </div>

        {/* Actions */}
        {!actionDone && (
          <div className="flex space-x-2 pt-2 border-t border-border">
              <button
                  onClick={handleApprove}
                  disabled={!!actionLoading}
                  className="flex-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/50 py-1.5 rounded text-xs font-bold flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {actionLoading === 'approve' ? (
                    <Loader2 size={14} className="mr-1.5 animate-spin" />
                  ) : (
                    <ThumbsUp size={14} className="mr-1.5" />
                  )}
                  {actionLoading === 'approve' ? 'Approving...' : 'Approve'}
              </button>
              <button
                  onClick={handlePass}
                  disabled={!!actionLoading}
                  className="flex-1 bg-surfaceHighlight hover:bg-zinc-200 dark:hover:bg-zinc-700 text-secondary border border-border py-1.5 rounded text-xs font-medium flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {actionLoading === 'pass' ? (
                    <Loader2 size={14} className="mr-1.5 animate-spin" />
                  ) : (
                    <ThumbsDown size={14} className="mr-1.5" />
                  )}
                  {actionLoading === 'pass' ? 'Passing...' : 'Pass'}
              </button>
              <button
                  onClick={() => console.log('Ask Jay', deal.id)}
                  disabled={!!actionLoading}
                  className="px-2 bg-surfaceHighlight hover:bg-blue-500/20 hover:text-blue-500 hover:border-blue-500/50 text-secondary border border-border rounded flex items-center justify-center transition-colors disabled:opacity-50"
                  title="Ask Jay">
                  <MessageSquare size={14} />
              </button>
          </div>
        )}
      </div>
    </div>
  );
};
