// Data layer: Google Sheets in production, an in-memory demo when no sheet is configured.
import { randomUUID } from "crypto";
import type { Account, AccountSnap, AlertRow, NewPost, PostRow, Snapshot } from "../types";
import * as sh from "./sheets";

export interface Store {
  demo: boolean;
  listPosts(): Promise<PostRow[]>;
  addPosts(rows: NewPost[], by: string): Promise<{ added: number; skipped: number }>;
  getPost(id: string): Promise<PostRow | null>;
  snapshots(id: string): Promise<Snapshot[]>;
  updatePost(id: string, patch: { campaign?: string | null; active?: boolean }): Promise<void>;
  deletePost(id: string): Promise<void>;
  listAccounts(): Promise<{ accounts: Account[]; snaps: AccountSnap[] }>;
  addAccount(platform: string, handle: string): Promise<void>;
  deleteAccount(id: string): Promise<void>;
  listAlerts(): Promise<AlertRow[]>;
}

const n = (v: unknown): number | null => (v === "" || v === null || v === undefined || isNaN(Number(v)) ? null : Math.round(Number(v)));
const nz = (v: string | undefined) => (v ? v : null);
const truthy = (v: unknown) => ["true", "1", "yes", "y"].includes(String(v).trim().toLowerCase());

/** points = [[iso, likes, comments, views], ...]; returns change vs the newest point that is >= 24h old. */
function delta24(hist: any[], latest: { likes: number | null; comments: number | null; views: number | null }) {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  let base: any[] | null = null;
  for (const p of hist) if (new Date(p[0]).getTime() <= cutoff) base = p;
  const d = (cur: number | null, old: unknown) => (cur === null || old === null || old === undefined ? null : cur - Number(old));
  return base
    ? { likes_24h: d(latest.likes, base[1]), comments_24h: d(latest.comments, base[2]), views_24h: d(latest.views, base[3]) }
    : { likes_24h: null, comments_24h: null, views_24h: null };
}

/* ---------------------------------------------------------------- Sheets */
let cache: { at: number; posts?: PostRow[] } = { at: 0 };
const bust = () => { cache = { at: 0 }; };

const sheetsStore: Store = {
  demo: false,
  async listPosts() {
    if (cache.posts && Date.now() - cache.at < 8000) return cache.posts;
    const [posts, summary] = await Promise.all([sh.readTab("st_posts"), sh.readTab("st_summary")]);
    const sum = new Map(summary.map((s) => [s.post_id, s]));
    const out: PostRow[] = posts.filter((p) => p.id).map((p) => {
      const s = sum.get(p.id);
      let hist: any[] = [];
      try { hist = s?.hist ? JSON.parse(s.hist) : []; } catch { /* ignore */ }
      const latest = { likes: n(s?.likes), comments: n(s?.comments), views: n(s?.views) };
      return {
        id: p.id, platform: p.platform as PostRow["platform"], url: p.url, external_id: p.external_id,
        title: nz(p.title), campaign: nz(p.campaign), author: nz(p.author), added_by: nz(p.added_by),
        active: truthy(p.active), last_error: nz(p.last_error), created_at: p.created_at,
        last_taken_at: nz(s?.last_taken_at), ...latest, shares: n(s?.shares), ...delta24(hist, latest),
      };
    });
    cache = { at: Date.now(), posts: out };
    return out;
  },
  async addPosts(rows, by) {
    const existing = new Set((await this.listPosts()).map((p) => `${p.platform}:${p.external_id}`));
    const fresh = rows.filter((r, i) => !existing.has(`${r.platform}:${r.external_id}`) && rows.findIndex((x) => x.platform === r.platform && x.external_id === r.external_id) === i);
    await sh.appendRows("st_posts", fresh.map((r) => ({
      id: randomUUID(), platform: r.platform, url: r.url, external_id: r.external_id, author: r.author ?? "",
      campaign: r.campaign ?? "", added_by: by, active: "TRUE", created_at: new Date().toISOString(),
    })));
    bust();
    return { added: fresh.length, skipped: rows.length - fresh.length };
  },
  async getPost(id) { return (await this.listPosts()).find((p) => p.id === id) ?? null; },
  async snapshots(id) {
    const rows = await sh.readTab("st_snapshots");
    return rows.filter((r) => r.post_id === id).map((r) => ({
      taken_at: r.taken_at, likes: n(r.likes), comments: n(r.comments), views: n(r.views), shares: n(r.shares),
    }));
  },
  async updatePost(id, patch) {
    const cols: Record<string, string> = {};
    if (patch.campaign !== undefined) cols.campaign = patch.campaign ?? "";
    if (patch.active !== undefined) cols.active = patch.active ? "TRUE" : "FALSE";
    await sh.updateCells("st_posts", id, cols);
    bust();
  },
  async deletePost(id) { await sh.deleteRowById("st_posts", id); bust(); },
  async listAccounts() {
    const [a, s] = await Promise.all([sh.readTab("st_accounts"), sh.readTab("st_account_snapshots")]);
    return {
      accounts: a.filter((x) => x.id).map((x) => ({ id: x.id, platform: x.platform as Account["platform"], handle: x.handle, active: truthy(x.active), last_error: nz(x.last_error) })),
      snaps: s.map((x) => ({ account_id: x.account_id, taken_at: x.taken_at, followers: n(x.followers) })),
    };
  },
  async addAccount(platform, handle) {
    const have = (await sh.readTab("st_accounts")).some((a) => a.platform === platform && a.handle.toLowerCase() === handle.toLowerCase());
    if (!have) await sh.appendRows("st_accounts", [{ id: randomUUID(), platform, handle, active: "TRUE", created_at: new Date().toISOString() }]);
  },
  async deleteAccount(id) { await sh.deleteRowById("st_accounts", id); },
  async listAlerts() {
    const rows = await sh.readTab("st_alerts");
    return rows.map((r, i) => ({ id: i, created_at: r.created_at, kind: r.kind, message: r.message })).reverse().slice(0, 200);
  },
};

/* ------------------------------------------------------------ Demo (RAM) */
type DemoDb = { posts: any[]; snaps: any[]; accounts: Account[]; accSnaps: AccountSnap[]; alerts: AlertRow[] };
const g = globalThis as unknown as { __demoDb?: DemoDb };

function seedDemo(): DemoDb {
  const now = Date.now();
  const posts: any[] = [], snaps: any[] = [];
  const defs: [string, string, string, string, string, number, number, string][] = [
    ["instagram", "DemoReel001", "Launch day reel", "brand_official", "Launch", 400, 60, "asha@team.com"],
    ["youtube", "dQw4w9WgXcQ", "Product walkthrough", "brand_channel", "Launch", 700, 35, "ravi@team.com"],
    ["instagram", "DemoPost002", "Behind the scenes", "brand_official", "Launch", 120, 18, "asha@team.com"],
    ["twitter", "1800000000000000001", "We just shipped v2.0!", "brand_x", "Launch", 80, 9, "ravi@team.com"],
    ["twitter", "1800000000000000002", "Thread: what we learned", "brand_x", "Evergreen", 300, 4, "asha@team.com"],
    ["instagram", "DemoReel003", "Customer story", "brand_official", "Evergreen", 900, 7, "ravi@team.com"],
  ];
  for (const [platform, id, title, author, campaign, base, rate, by] of defs) {
    const url = platform === "instagram" ? `https://www.instagram.com/reel/${id}` : platform === "youtube" ? `https://www.youtube.com/watch?v=${id}` : `https://x.com/${author}/status/${id}`;
    const post = { id: randomUUID(), platform, url, external_id: id, title, campaign, author, added_by: by, active: true, last_error: null, created_at: new Date(now - 6 * 864e5).toISOString() };
    posts.push(post);
    let likes = base;
    for (let h = 24 * 6; h >= 0; h--) {
      likes += Math.round(rate * (0.5 + Math.random()) * Math.exp(-(24 * 6 - h) / 150));
      snaps.push({ post_id: post.id, taken_at: new Date(now - h * 36e5).toISOString(), likes, comments: Math.round(likes * 0.04), views: platform === "twitter" ? null : likes * (platform === "youtube" ? 30 : 18), shares: null });
    }
  }
  posts[4].last_error = "Twitter rate limit (429)";
  const accounts: Account[] = [
    { id: randomUUID(), platform: "instagram", handle: "brand_official", active: true, last_error: null },
    { id: randomUUID(), platform: "youtube", handle: "brand_channel", active: true, last_error: null },
    { id: randomUUID(), platform: "twitter", handle: "brand_x", active: true, last_error: null },
  ];
  const accSnaps: AccountSnap[] = [];
  accounts.forEach((a, i) => {
    let f = [12800, 3100, 5200][i];
    for (let h = 24 * 6; h >= 0; h -= 3) { f += Math.round(Math.random() * 12); accSnaps.push({ account_id: a.id, taken_at: new Date(now - h * 36e5).toISOString(), followers: f }); }
  });
  const alerts: AlertRow[] = [
    { id: 1, created_at: new Date(now - 5 * 36e5).toISOString(), kind: "spike", message: `instagram spike: likes 410 -> 560 (+37%) ${posts[0].url}` },
    { id: 2, created_at: new Date(now - 30 * 36e5).toISOString(), kind: "drop", message: `twitter drop: likes 90 -> 52 (-42%) ${posts[3].url}` },
  ];
  return { posts, snaps, accounts, accSnaps, alerts };
}
const db = (): DemoDb => (g.__demoDb ??= seedDemo());

const demoStore: Store = {
  demo: true,
  async listPosts() {
    const d = db();
    return d.posts.map((p) => {
      const s = d.snaps.filter((x) => x.post_id === p.id);
      const l = s[s.length - 1];
      const hist = s.map((x) => [x.taken_at, x.likes, x.comments, x.views]);
      const latest = { likes: n(l?.likes), comments: n(l?.comments), views: n(l?.views) };
      return { ...p, last_taken_at: l?.taken_at ?? null, ...latest, shares: null, ...delta24(hist, latest) } as PostRow;
    });
  },
  async addPosts(rows, by) {
    const d = db();
    let added = 0;
    for (const r of rows) {
      if (d.posts.some((p) => p.platform === r.platform && p.external_id === r.external_id)) continue;
      d.posts.push({ id: randomUUID(), ...r, title: null, campaign: r.campaign ?? null, author: r.author ?? null, added_by: by, active: true, last_error: null, created_at: new Date().toISOString() });
      added++;
    }
    return { added, skipped: rows.length - added };
  },
  async getPost(id) { return (await this.listPosts()).find((p) => p.id === id) ?? null; },
  async snapshots(id) { return db().snaps.filter((s) => s.post_id === id); },
  async updatePost(id, patch) {
    const p = db().posts.find((x) => x.id === id);
    if (!p) throw new Error("not found");
    if (patch.campaign !== undefined) p.campaign = patch.campaign;
    if (patch.active !== undefined) p.active = patch.active;
  },
  async deletePost(id) { const d = db(); d.posts = d.posts.filter((p) => p.id !== id); d.snaps = d.snaps.filter((s) => s.post_id !== id); },
  async listAccounts() { return { accounts: db().accounts, snaps: db().accSnaps }; },
  async addAccount(platform, handle) {
    const d = db();
    if (!d.accounts.some((a) => a.platform === platform && a.handle.toLowerCase() === handle.toLowerCase()))
      d.accounts.push({ id: randomUUID(), platform: platform as Account["platform"], handle, active: true, last_error: null });
  },
  async deleteAccount(id) { const d = db(); d.accounts = d.accounts.filter((a) => a.id !== id); d.accSnaps = d.accSnaps.filter((s) => s.account_id !== id); },
  async listAlerts() { return db().alerts; },
};

export const store: Store = sh.sheetsConfigured() ? sheetsStore : demoStore;
