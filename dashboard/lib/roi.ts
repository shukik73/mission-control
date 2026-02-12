/**
 * Unified ROI Calculation — Single Source of Truth
 *
 * Includes platform fees in all calculations:
 * - eBay final value fee: 12.9% + $0.30
 * - Payment processing fee: 2.9% + $0.30
 */

// Platform fee constants
const EBAY_FEE_PERCENT = 0.129;
const EBAY_FEE_FIXED = 0.30;
const PAYMENT_FEE_PERCENT = 0.029;
const PAYMENT_FEE_FIXED = 0.30;

export interface ROIInput {
  cost: number;        // item purchase price
  shipping: number;    // shipping cost to buyer or to you
  pickupCost?: number; // local pickup cost (gas + time)
  marketValue: number; // estimated sale price
}

export interface ROIResult {
  totalCost: number;
  platformFees: number;
  netRevenue: number;
  profit: number;
  roi: number;         // percentage
  feeBreakdown: {
    ebayFee: number;
    paymentFee: number;
    pickupCost: number;
  };
}

/**
 * Calculate ROI including all platform fees.
 * This is the ONLY function that should be used for ROI calculations.
 */
export function calculateROI(input: ROIInput): ROIResult {
  const { cost, shipping, pickupCost = 0, marketValue } = input;

  // Total acquisition cost
  const totalCost = cost + shipping + pickupCost;

  // Platform fees (calculated on sale price)
  const ebayFee = (marketValue * EBAY_FEE_PERCENT) + EBAY_FEE_FIXED;
  const paymentFee = (marketValue * PAYMENT_FEE_PERCENT) + PAYMENT_FEE_FIXED;
  const platformFees = ebayFee + paymentFee;

  // Net revenue after platform takes their cut
  const netRevenue = marketValue - platformFees;

  // Actual profit
  const profit = netRevenue - totalCost;

  // ROI percentage
  const roi = totalCost > 0 ? (profit / totalCost) * 100 : (marketValue > 0 ? 100 : 0);

  return {
    totalCost,
    platformFees,
    netRevenue,
    profit,
    roi,
    feeBreakdown: {
      ebayFee,
      paymentFee,
      pickupCost,
    },
  };
}

/**
 * Quick ROI check for filtering — returns the fee-adjusted ROI percentage.
 */
export function quickROI(cost: number, shipping: number, marketValue: number): number {
  return calculateROI({ cost, shipping, marketValue }).roi;
}
