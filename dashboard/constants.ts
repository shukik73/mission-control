import { Agent, Deal, DealStatus, Priority } from './types';

const NOW = new Date();

export const MOCK_AGENTS: Agent[] = [
  {
    id: 'jay',
    name: 'Jay',
    role: 'Squad Lead & Execution',
    status: 'active',
    lastActive: new Date(NOW.getTime() - 2 * 60000),
    dealsFound: 0,
    dealsPending: 0,
    currentStream: 'Techy Miramar'
  },
  {
    id: 'kai',
    name: 'Kai',
    role: 'Assistant',
    status: 'active',
    lastActive: new Date(NOW.getTime() - 5 * 60000),
    dealsFound: 0,
    dealsPending: 0,
    currentStream: 'Techy Miramar'
  },
  {
    id: 'scout',
    name: 'Scout Baz',
    role: 'eBay/Amazon Sourcing',
    status: 'active',
    lastActive: new Date(NOW.getTime() - 8 * 60000),
    dealsFound: 124,
    dealsPending: 3,
    currentStream: 'Techy Miramar'
  },
  {
    id: 'pixel',
    name: 'Pixel',
    role: 'Creative Asset Production',
    status: 'waiting',
    lastActive: new Date(NOW.getTime() - 30 * 60000),
    dealsFound: 0,
    dealsPending: 0,
    currentStream: 'Techy Miramar'
  },
  {
    id: 'emilio',
    name: 'Igor',
    role: 'Cold Email Campaigns',
    status: 'waiting',
    lastActive: new Date(NOW.getTime() - 45 * 60000),
    dealsFound: 15,
    dealsPending: 0,
    currentStream: 'Techy Miramar'
  },
  {
    id: 'iron-sec',
    name: 'Secretary',
    role: 'Calls & Customer Mgmt',
    status: 'active',
    lastActive: new Date(NOW.getTime() - 10 * 60000),
    dealsFound: 82,
    dealsPending: 0,
    currentStream: 'Techy Miramar'
  },
  {
    id: 'hamoriko',
    name: 'Hamoriko Producer',
    role: 'YouTube Content',
    status: 'active',
    lastActive: new Date(NOW.getTime() - 2 * 60000),
    dealsFound: 340,
    dealsPending: 12,
    currentStream: 'Techy Miramar'
  },
  {
    id: 'buzz',
    name: 'Buzz',
    role: 'Social Media Management',
    status: 'waiting',
    lastActive: new Date(NOW.getTime() - 60 * 60000),
    dealsFound: 0,
    dealsPending: 0,
    currentStream: 'Techy Miramar'
  },
  {
    id: 'valet',
    name: 'Valet',
    role: 'Scheduling & Calendar',
    status: 'paused',
    lastActive: new Date(NOW.getTime() - 9999 * 60000),
    dealsFound: 0,
    dealsPending: 0,
    currentStream: 'Techy Miramar'
  },
  {
    id: 'radar',
    name: 'Radar',
    role: 'Competitive Intel',
    status: 'paused',
    lastActive: new Date(NOW.getTime() - 9999 * 60000),
    dealsFound: 0,
    dealsPending: 0,
    currentStream: 'Techy Miramar'
  },
  {
    id: 'penny',
    name: 'Penny',
    role: 'Bookkeeping & Finance',
    status: 'paused',
    lastActive: new Date(NOW.getTime() - 9999 * 60000),
    dealsFound: 0,
    dealsPending: 0,
    currentStream: 'Techy Miramar'
  },
  {
    id: 'echo',
    name: 'Echo',
    role: 'Reviews & Feedback',
    status: 'paused',
    lastActive: new Date(NOW.getTime() - 9999 * 60000),
    dealsFound: 0,
    dealsPending: 0,
    currentStream: 'Techy Miramar'
  },
  {
    id: 'developer',
    name: 'Developer',
    role: 'Full-Stack Dev & Automation',
    status: 'paused',
    lastActive: new Date(NOW.getTime() - 9999 * 60000),
    dealsFound: 0,
    dealsPending: 0,
    currentStream: 'Techy Miramar'
  }
];

export const MOCK_DEALS: Deal[] = [
  // --- INBOX (Scout Deals) ---
  {
    id: 'd1',
    title: 'MacBook Pro A1502 Logic Board 8GB',
    source: 'eBay',
    location: 'Miami, FL',
    endsAt: new Date(NOW.getTime() + 135 * 60000), // 2h 15m
    cost: 89,
    shipping: 0,
    marketValue: 180,
    sellerRating: 98,
    sellerSales: 2400,
    localPickup: true,
    distanceMiles: 12,
    status: DealStatus.Inbox,
    category: 'electronics',
    stream: 'deal'
  },
  {
    id: 'd2',
    title: 'Sony WH-1000XM4 Wireless Headphones - Black',
    source: 'Mercari',
    location: 'Austin, TX',
    endsAt: new Date(NOW.getTime() + 45 * 60000), // 45m (Urgent Time)
    cost: 120,
    shipping: 15,
    marketValue: 240,
    sellerRating: 100,
    sellerSales: 54,
    localPickup: false,
    status: DealStatus.Inbox,
    category: 'electronics',
    stream: 'deal'
  },
  // --- LOW ROI AUTO-PASS TEST CASE ---
  // ROI calculation: Total 110. Val 130. Profit 20. ROI = 18%. 
  // Should be hidden by App.tsx logic.
  {
    id: 'd3',
    title: 'Nintendo Switch Lite (Coral) - Console Only',
    source: 'OfferUp',
    location: 'Los Angeles, CA',
    endsAt: new Date(NOW.getTime() + 300 * 60000), 
    cost: 110,
    shipping: 0,
    marketValue: 130,
    sellerRating: 85,
    sellerSales: 12,
    localPickup: true,
    status: DealStatus.Inbox,
    category: 'electronics',
    stream: 'deal'
  },
  
  // --- NEEDS SHUKI ---
  {
    id: 'd4',
    title: 'Bulk Lot: 5x iPhone 11 Pro Max (Cracked Backs)',
    source: 'Direct',
    location: 'New York, NY',
    endsAt: new Date(NOW.getTime() + 90 * 60000),
    cost: 900,
    shipping: 50,
    marketValue: 2100,
    sellerRating: 99,
    sellerSales: 5000,
    localPickup: false,
    status: DealStatus.NeedsShuki,
    priority: Priority.Urgent,
    category: 'electronics',
    stream: 'deal'
  },
  // --- ROLEX OUTLIER ---
  {
    id: 'd5',
    title: 'Rolex Submariner Box & Papers Only',
    source: 'eBay',
    location: 'Chicago, IL',
    endsAt: new Date(NOW.getTime() + 1440 * 60000), // 1 day
    cost: 350,
    shipping: 20,
    marketValue: 800,
    sellerRating: 92,
    sellerSales: 300,
    localPickup: false,
    status: DealStatus.NeedsShuki,
    priority: Priority.High,
    category: 'other', // Should flag category validation
    stream: 'deal'
  },
  // --- SAAS TASKS ---
  {
    id: 's1',
    title: 'Server Capacity Warning (92%)',
    source: 'System',
    location: 'AWS-East',
    endsAt: new Date(NOW.getTime() + 60 * 60000),
    cost: 0,
    shipping: 0,
    marketValue: 0,
    sellerRating: 0,
    sellerSales: 0,
    localPickup: false,
    status: DealStatus.Inbox,
    priority: Priority.Urgent,
    category: 'electronics',
    stream: 'saas'
  },
  {
    id: 's2',
    title: 'Unpaid Invoice #9921',
    source: 'Stripe',
    location: 'Dashboard',
    endsAt: new Date(NOW.getTime() + 2880 * 60000),
    cost: 0,
    shipping: 0,
    marketValue: 299,
    sellerRating: 0,
    sellerSales: 0,
    localPickup: false,
    status: DealStatus.NeedsShuki,
    priority: Priority.High,
    category: 'other',
    stream: 'saas'
  },
  // --- WEEKLY INTELLIGENCE REPORT ---
  {
    id: 'rep1',
    title: "Scout's Weekly Intelligence Report",
    source: 'Scout',
    location: 'Internal',
    endsAt: new Date(NOW.getTime() + 100000 * 60000),
    cost: 0,
    shipping: 0,
    marketValue: 0,
    sellerRating: 100,
    sellerSales: 0,
    localPickup: false,
    status: DealStatus.Review,
    category: 'other',
    stream: 'deal'
  }
];