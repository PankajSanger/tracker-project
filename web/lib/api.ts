// Browser-side calls to the app's own API routes (which talk to Google Sheets).
import type { Account, AccountSnap, AlertRow, PostRow, Snapshot } from "./types";

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
    return b as { email: string; demo: boolean };
  },
  login: (email: string, password: string) => j<{ email: string }>("/api/login", send("POST", { email, password })),
  logout: () => j<{ ok: boolean }>("/api/logout", send("POST")),
  posts: () => j<PostRow[]>("/api/posts"),
  addPosts: (urls: string[], campaign: string) =>
    j<{ added: number; skipped: number; bad: string[] }>("/api/posts", send("POST", { urls, campaign })),
  post: (id: string) => j<{ post: PostRow; snapshots: Snapshot[] }>(`/api/posts/${id}`),
  updatePost: (id: string, patch: { campaign?: string | null; active?: boolean }) => j(`/api/posts/${id}`, send("PATCH", patch)),
  deletePost: (id: string) => j(`/api/posts/${id}`, send("DELETE")),
  accounts: () => j<{ accounts: Account[]; snaps: AccountSnap[] }>("/api/accounts"),
  addAccount: (platform: string, handle: string) => j("/api/accounts", send("POST", { platform, handle })),
  deleteAccount: (id: string) => j(`/api/accounts/${id}`, send("DELETE")),
  alerts: () => j<AlertRow[]>("/api/alerts"),
};
