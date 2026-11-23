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
  thumbnail: string | null;    // post image (Instagram links expire; the scraper refreshes them on every check)
}

/** A read-only report link for clients. campaign null = all posts. */
export interface ShareLink {
  token: string;
  campaign: string | null;
  created_by: string;
  created_at: string;
}

export interface ReportPost {
  id: string;
  platform: Platform;
  url: string;
  title: string | null;
  author: string | null;
  campaign: string | null;
  thumbnail: string | null;
  created_at: string;
  last_taken_at: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
  g_likes: number;     // growth inside the report period
  g_comments: number;
  g_views: number;
}

export interface Report {
  campaign: string | null;
  days: number;            // 0 = all time
  generated_at: string;
  first_at: string | null; // earliest data point of these posts
  posts: ReportPost[];
  overview: Overview;
  totals: { likes: number; comments: number; views: number; posts: number };
  shared: boolean;         // opened through a share link (read-only client view)
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
  account_period_days: number; // followers: once per calendar 1=day, 7=week, 30=month, 365=year
}

export const ACCOUNT_PERIODS: { days: number; label: string; noun: string }[] = [
  { days: 1, label: "Daily", noun: "day" },
  { days: 7, label: "Weekly", noun: "week" },
  { days: 30, label: "Monthly", noun: "month" },
  { days: 365, label: "Yearly", noun: "year" },
];

export const DEFAULT_SETTINGS: Settings = {
  interval_instagram: 180,
  interval_twitter: 60,
  interval_youtube: 60,
  alert_spike_pct: 25,
  alert_spike_min: 50,
  account_period_days: 1,
};

/** Auto-track: an account whose new posts are added and tracked automatically. */
export interface Watch {
  id: string;
  platform: Platform;
  handle: string;
  campaign: string | null;
  active: boolean;
  interval_min: number | null; // how often to look for new posts (null = default, 3 hours)
  since: string | null;        // only posts published after this are added
  last_checked: string | null;
  last_found: string | null;
  posts_found: number;
  last_error: string | null;
  created_at: string;
  added_by: string | null;
}

export interface NewWatch {
  platform: Platform;
  handle: string;
  campaign: string | null;
  interval_min: number;
  backfill_days: number; // 0 = only posts published from now on
}

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
  prev_growth: { likes: number; comments: number; views: number } | null; // same-length period before (null for "all")
  post_growth: Record<string, { likes: number; comments: number; views: number }>; // per post, inside the period
  days: number;
}

export interface CompareResult {
  series: Record<string, Snapshot[]>;
}
