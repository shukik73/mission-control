export enum DealStatus {
  Inbox = 'Inbox',
  Review = 'Review',
  NeedsShuki = 'Needs Shuki',
  Done = 'Done'
}

export enum Priority {
  Urgent = 'Urgent',
  High = 'High',
  Normal = 'Normal'
}

export type Category = 'electronics' | 'other';
export type StreamType = 'deal' | 'saas';

export interface Deal {
  id: string;
  title: string;
  source: string;
  location: string;
  endsAt: Date;
  cost: number;
  shipping: number;
  marketValue: number;
  sellerRating: number;
  sellerSales: number;
  localPickup: boolean;
  status: DealStatus;
  priority?: Priority;
  itemUrl?: string;
  thumbnail?: string;
  // New Fields
  category: Category;
  distanceMiles?: number;
  stream: StreamType;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: 'active' | 'waiting' | 'paused';
  lastActive: Date;
  dealsFound: number;
  dealsPending: number;
  currentStream: string;
}

export const STREAMS = [
  'All Streams',
  'Techy Miramar'
];