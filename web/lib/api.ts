// Browser-side calls to the app's own API routes (which talk to Google Sheets).
import type { Account, AccountSnap, AlertRow, CompareResult, NewWatch, Overview, PostRow, Report, Settings, ShareLink, Snapshot, Watch } from "./types";

export class Unauthorized extends Error {}

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json" }, cache: "no-store" });
  if (r.status === 401 && !url.endsWith("/login") && !url.endsWith("/me")) {
    if (typeof window !== "undefined") window.location.reload(); // session expired -> back to the login form
    throw new Unauthorized();
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || r.statusText);
  return body as T;
}

const send = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  me: async () => {
    const r = await fetch("/api/me", { cache: "no-store" });
    const b = await r.json();
    if (!r.ok) { const e: any = new Error("signed out"); e.demo = b.demo; throw e; }
    return b as { email: string; demo: boolean; sheetUrl: string | null };
  },
  login: (email: string, password: string) => j<{ email: string }>("/api/login", send("POST", { email, password })),
  logout: () => j<{ ok: boolean }>("/api/logout", send("POST")),
  posts: () => j<PostRow[]>("/api/posts"),
  addPosts: (urls: string[], campaign: string) =>
    j<{ added: number; skipped: number; bad: string[] }>("/api/posts", send("POST", { urls, campaign })),
  post: (id: string) => j<{ post: PostRow; snapshots: Snapshot[] }>(`/api/posts/${id}`),
  updatePost: (id: string, patch: { campaign?: string | null; active?: boolean; interval_min?: number | null }) => j(`/api/posts/${id}`, send("PATCH", patch)),
  deletePost: (id: string) => j(`/api/posts/${id}`, send("DELETE")),
  checkNow: (id: string) => j(`/api/posts/${id}`, send("PATCH", { check_now: true })),
  accounts: () => j<{ accounts: Account[]; snaps: AccountSnap[] }>("/api/accounts"),
  addAccount: (platform: string, handle: string) => j("/api/accounts", send("POST", { platform, handle })),
  deleteAccount: (id: string) => j(`/api/accounts/${id}`, send("DELETE")),
  alerts: () => j<AlertRow[]>("/api/alerts"),
  settings: () => j<Settings>("/api/settings"),
  saveSettings: (patch: Partial<Settings>) => j<Settings>("/api/settings", send("PUT", patch)),
  overview: (days: number) => j<Overview>(`/api/overview?days=${days}`),
  compare: (ids: string[]) => j<CompareResult>(`/api/compare?ids=${ids.join(",")}`),
  shares: () => j<ShareLink[]>("/api/shares"),
  createShare: (campaign: string | null) => j<ShareLink>("/api/shares", send("POST", { campaign })),
  revokeShare: (token: string) => j(`/api/shares?token=${encodeURIComponent(token)}`, send("DELETE")),
  watches: () => j<Watch[]>("/api/watches"),
  addWatch: (w: NewWatch) => j<{ added: boolean }>("/api/watches", send("POST", w)),
  updateWatch: (id: string, patch: { active?: boolean; interval_min?: number | null; campaign?: string | null }) => j(`/api/watches/${id}`, send("PATCH", patch)),
  deleteWatch: (id: string) => j(`/api/watches/${id}`, send("DELETE")),
};

/** Report data; works signed out when a share token is given (no reload-on-401 here). */
export async function fetchReport(opts: { token?: string | null; campaign?: string | null; days: number }): Promise<Report> {
  const q = new URLSearchParams({ days: String(opts.days) });
  if (opts.token) q.set("t", opts.token);
  else if (opts.campaign !== null && opts.campaign !== undefined) q.set("c", opts.campaign);
  const r = await fetch(`/api/report?${q}`, { cache: "no-store" });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { const e: any = new Error(body.error || r.statusText); e.status = r.status; throw e; }
  return body as Report;
}
