import type { Platform, PostRow } from "./types";

export function parsePostUrl(
  raw: string
): { platform: Platform; external_id: string; url: string; author?: string } | null {
  const raw0 = raw.trim();
  const yt = raw0.match(/(?:youtube\.com\/(?:watch\?(?:[^\s]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (yt) return { platform: "youtube", external_id: yt[1], url: `https://www.youtube.com/watch?v=${yt[1]}` };
  const url = raw0.split("?")[0].replace(/\/$/, "");
  let m = url.match(/instagram\.com\/(?:[\w.]+\/)?(?:p|reel|tv|reels)\/([A-Za-z0-9_-]+)/);
  if (m) return { platform: "instagram", external_id: m[1], url };
  m = url.match(/(?:twitter|x)\.com\/(\w+)\/status(?:es)?\/(\d+)/);
  if (m) return { platform: "twitter", external_id: m[2], url, author: m[1] };
  return null;
}

export const fmt = (n: number | null | undefined) =>
  n == null
    ? "-"
    : n >= 1e9
    ? (n / 1e9).toFixed(2) + "B"
    : n >= 1e6
    ? (n / 1e6).toFixed(1) + "M"
    : n >= 1e4
    ? (n / 1e3).toFixed(1) + "K"
    : n.toLocaleString();

export const delta = (n: number | null | undefined) =>
  n == null ? "" : (n > 0 ? "+" : "") + n.toLocaleString();

export const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 5400) return Math.round(s / 60) + "m ago";
  if (s < 129600) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
};

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = name;
  a.click();
}

export const PLATFORM_LABEL: Record<string, string> = { instagram: "Instagram", twitter: "X / Twitter", youtube: "YouTube" };
export const PLATFORM_SHORT: Record<string, string> = { instagram: "IG", twitter: "X", youtube: "YT" };

/* ---------------------------------------------------------------- extras */

export const INTERVALS = [15, 30, 60, 180, 360, 720, 1440];

export const intervalLabel = (m: number) =>
  m < 60 ? `${m} min` : m % 1440 === 0 ? `${m / 1440} day${m / 1440 > 1 ? "s" : ""}` : `${m / 60} hour${m / 60 > 1 ? "s" : ""}`;

export const PLATFORM_COLOR: Record<string, string> = { instagram: "#d62976", youtube: "#ff0033", twitter: "#475569" };

/** (likes + comments) / views, in percent. Null when views are unknown. */
export const engagement = (p: { likes: number | null; comments: number | null; views: number | null }) =>
  p.views && p.views > 0 ? (((p.likes ?? 0) + (p.comments ?? 0)) / p.views) * 100 : null;

export const pct = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? "-" : `${n.toFixed(digits)}%`);

/** True when the views shown are a carried-forward value from an earlier check. */
export const viewsStale = (p: Pick<PostRow, "views_at" | "last_taken_at" | "views">) =>
  p.views !== null && !!p.views_at && !!p.last_taken_at && new Date(p.last_taken_at).getTime() - new Date(p.views_at).getTime() > 2 * 3600 * 1000;

export const postTitle = (p: Pick<PostRow, "title" | "author" | "external_id">) => p.title || p.author || p.external_id;

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

/** Effective tracking interval for a post: its override, else the platform default from settings. */
export const effectiveInterval = (p: Pick<PostRow, "interval_min" | "platform">, defaults: Record<string, number>) =>
  p.interval_min ?? defaults[`interval_${p.platform}`] ?? 60;

/** A post is stale when its newest numbers are older than 2.5x its interval (or it never got any). */
export function isStale(p: Pick<PostRow, "last_taken_at" | "active" | "created_at">, intervalMin: number): boolean {
  if (!p.active) return false;
  const ref = p.last_taken_at ?? null;
  if (!ref) return Date.now() - new Date(p.created_at).getTime() > Math.max(intervalMin, 120) * 60000 * 1.5;
  return Date.now() - new Date(ref).getTime() > intervalMin * 60000 * 2.5;
}
