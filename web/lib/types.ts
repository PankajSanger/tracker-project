export type Platform = "instagram" | "twitter" | "youtube";

export interface PostRow {
  id: string;
  platform: Platform;
  url: string;
  external_id: string;
  title: string | null;
  campaign: string | null;
  author: string | null;
  added_by: string | null;
  active: boolean;
  last_error: string | null;
  created_at: string;
  last_taken_at: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
  shares: number | null;
  likes_24h: number | null;
  comments_24h: number | null;
  views_24h: number | null;
  views_at: string | null;     // when the shown views were last actually seen (Instagram: only recent reels expose views)
  interval_min: number | null; // per-post tracking interval override (minutes); null = platform default
  spark: number[];             // recent likes values for the sparkline
  spark_views: number[];
}

export interface Snapshot {
  taken_at: string;
  likes: number | null;
  comments: number | null;
  views: number | null;
  shares: number | null;
}

export interface Account {
  id: string;
  platform: Platform;
  handle: string;
  active: boolean;
  last_error: string | null;
}

export interface AccountSnap {
  account_id: string;
  taken_at: string;
  followers: number | null;
}

export interface AlertRow {
  id: number;
  created_at: string;
  kind: string;
  message: string;
}

export interface NewPost {
  platform: Platform;
  external_id: string;
  url: string;
  author?: string | null;
  campaign?: string | null;
}

export interface Settings {
  interval_instagram: number; // minutes between checks, per platform
  interval_twitter: number;
  interval_youtube: number;
  alert_spike_pct: number;
  alert_spike_min: number;
}

export const DEFAULT_SETTINGS: Settings = {
  interval_instagram: 180,
  interval_twitter: 60,
  interval_youtube: 60,
  alert_spike_pct: 25,
  alert_spike_min: 50,
};

export interface OverviewPoint {
  t: number;
  likes: number;
  comments: number;
  views: number;
  g_likes: number;    // growth since the start of the range
  g_comments: number;
  g_views: number;
}

export interface Overview {
  series: OverviewPoint[];
  growth: { likes: number; comments: number; views: number };
  days: number;
}

export interface CompareResult {
  series: Record<string, Snapshot[]>;
}
