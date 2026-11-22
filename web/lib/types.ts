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
