import type { Platform } from "./types";

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
