// Data layer: Google Sheets in production, an in-memory demo when no sheet is configured.
import { randomUUID } from "crypto";
import { DEFAULT_SETTINGS } from "../types";
import type { Account, AccountSnap, AlertRow, NewPost, Overview, PostRow, Settings, Snapshot } from "../types";
import { buildOverview, downsample, groupSeries, type SnapRow } from "./analytics";
import * as sh from "./sheets";

export interface PostPatch {
  campaign?: string | null;
  active?: boolean;
  interval_min?: number | null;
}

export interface Store {
  demo: boolean;
  sheetUrl: string | null;
  listPosts(): Promise<PostRow[]>;
  addPosts(rows: NewPost[], by: string): Promise<{ added: number; skipped: number }>;
  getPost(id: string): Promise<PostRow | null>;
  snapshots(id: string): Promise<Snapshot[]>;
  updatePost(id: string, patch: PostPatch): Promise<void>;
  deletePost(id: string): Promise<void>;
  listAccounts(): Promise<{ accounts: Account[]; snaps: AccountSnap[] }>;
  addAccount(platform: string, handle: string): Promise<void>;
  deleteAccount(id: string): Promise<void>;
  listAlerts(): Promise<AlertRow[]>;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  overview(days: number): Promise<Overview>;
  compare(ids: string[]): Promise<Record<string, Snapshot[]>>;
}

const n = (v: unknown): number | null => (v === "" || v === null || v === undefined || isNaN(Number(v)) ? null : Math.round(Number(v)));
const nz = (v: string | undefined) => (v ? v : null);
const truthy = (v: unknown) => ["true", "1", "yes", "y"].includes(String(v).trim().toLowerCase());

/** hist = [[iso, likes, comments, views], ...]; change vs the newest point that is >= 24h old. */
function delta24(hist: any[], latest: { likes: number | null; comments: number | null; views: number | null }) {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  let base: any[] | null = null;
  for (const p of hist) if (new Date(p[0]).getTime() <= cutoff) base = p;
  const d = (cur: number | null, old: unknown) => (cur === null || old === null || old === undefined ? null : cur - Number(old));
  return base
    ? { likes_24h: d(latest.likes, base[1]), comments_24h: d(latest.comments, base[2]), views_24h: d(latest.views, base[3]) }
    : { likes_24h: null, comments_24h: null, views_24h: null };
}

const sparkOf = (hist: any[], idx: number) => downsample(hist.map((p) => Number(p[idx]) || 0), 24);

const cleanSettings = (patch: Partial<Settings>): Partial<Settings> => {
  const out: Partial<Settings> = {};
  (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).forEach((k) => {
    if (patch[k] === undefined) return;
    const v = Number(patch[k]);
    if (!Number.isFinite(v)) return;
    out[k] = k.startsWith("interval_") ? Math.min(Math.max(Math.round(v), 15), 7 * 1440) : Math.min(Math.max(v, 0), 1e9);
  });
  return out;
};

/* ---------------------------------------------------------------- Sheets */
let cache: { at: number; posts?: PostRow[]; snaps?: { at: number; rows: SnapRow[] } } = { at: 0 };
const bust = () => { cache = { at: 0 }; };

async function allSnaps(): Promise<SnapRow[]> {
  if (cache.snaps && Date.now() - cache.snaps.at < 30000) return cache.snaps.rows;
  const rows = (await sh.readTab("st_snapshots")).map((r) => ({
    post_id: r.post_id, taken_at: r.taken_at, likes: n(r.likes), comments: n(r.comments), views: n(r.views), shares: n(r.shares),
  }));
  cache.snaps = { at: Date.now(), rows };
  return rows;
}

const sheetsStore: Store = {
  demo: false,
  sheetUrl: sh.sheetUrl(),
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
        interval_min: n(p.interval_min), spark: sparkOf(hist, 1), spark_views: sparkOf(hist, 3),
      };
    });
    cache = { ...cache, at: Date.now(), posts: out };
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
    return (await allSnaps()).filter((r) => r.post_id === id).map(({ post_id: _p, ...rest }) => rest);
  },
  async updatePost(id, patch) {
    const cols: Record<string, string> = {};
    if (patch.campaign !== undefined) cols.campaign = patch.campaign ?? "";
    if (patch.active !== undefined) cols.active = patch.active ? "TRUE" : "FALSE";
    if (patch.interval_min !== undefined) cols.interval_min = patch.interval_min === null ? "" : String(patch.interval_min);
    if (Object.keys(cols).length) await sh.updateCells("st_posts", id, cols);
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
  async getSettings() {
    const rows = await sh.readTab("st_settings");
    const merged: Settings = { ...DEFAULT_SETTINGS };
    const clean = cleanSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])) as Partial<Settings>);
    return { ...merged, ...clean };
  },
  async setSettings(patch) {
    const clean = cleanSettings(patch);
    await sh.upsertKV("st_settings", Object.fromEntries(Object.entries(clean).map(([k, v]) => [k, String(v)])));
    return this.getSettings();
  },
  async overview(days) { return buildOverview(await allSnaps(), days); },
  async compare(ids) { return groupSeries(await allSnaps(), ids); },
};

/* ------------------------------------------------------------ Demo (RAM) */
type DemoDb = { posts: any[]; snaps: SnapRow[]; accounts: Account[]; accSnaps: AccountSnap[]; alerts: AlertRow[]; settings: Settings };
const g = globalThis as unknown as { __demoDb?: DemoDb };

function seedDemo(): DemoDb {
  const now = Date.now();
  const posts: any[] = [];
  const snaps: SnapRow[] = [];
  const defs: [string, string, string, string, string, number, number, string][] = [
    ["instagram", "DemoReel001", "Launch day reel: behind the scenes of our biggest release yet", "brand_official", "Launch", 4000, 260, "asha@team.com"],
    ["youtube", "dQw4w9WgXcQ", "Product walkthrough: everything new in v2.0 in 10 minutes", "Brand Channel", "Launch", 7000, 190, "ravi@team.com"],
    ["instagram", "DemoPost002", "Meet the team: a day at the studio", "brand_official", "Launch", 1200, 70, "asha@team.com"],
    ["twitter", "1800000000000000001", "We just shipped v2.0! Here is what changed and why it matters", "brand_x", "Launch", 800, 40, "ravi@team.com"],
    ["twitter", "1800000000000000002", "Thread: 12 lessons from building in public", "brand_x", "Evergreen", 3000, 14, "asha@team.com"],
    ["instagram", "DemoReel003", "Customer story: how Priya doubled her output", "brand_official", "Evergreen", 9000, 22, "ravi@team.com"],
    ["youtube", "DemoVideo004", "Tutorial: getting started in 5 minutes", "Brand Channel", "Evergreen", 12000, 60, "asha@team.com"],
    ["youtube", "DemoVideo005", "Live Q&A recap", "Brand Channel", "Community", 2200, 12, "ravi@team.com"],
  ];
  defs.forEach(([platform, id, title, author, campaign, base, rate, by], di) => {
    const url = platform === "instagram" ? `https://www.instagram.com/reel/${id}` : platform === "youtube" ? `https://www.youtube.com/watch?v=${id}` : `https://x.com/${author}/status/${id}`;
    const post = { id: randomUUID(), platform, url, external_id: id, title, campaign, author, added_by: by, active: true, last_error: null, created_at: new Date(now - 14 * 864e5).toISOString(), interval_min: null };
    posts.push(post);
    let likes = base;
    for (let h = 24 * 14; h >= 0; h -= 2) {
      likes += Math.round(rate * 2 * (0.5 + Math.random()) * (0.35 + Math.exp(-(24 * 14 - h) / 120)) * (1 + 0.6 * Math.sin((h + di * 5) / 9)) * 0.6);
      snaps.push({ post_id: post.id, taken_at: new Date(now - h * 36e5).toISOString(), likes, comments: Math.round(likes * 0.035), views: platform === "twitter" ? null : likes * (platform === "youtube" ? 28 : 17), shares: null });
    }
  });
  posts[4].last_error = "Twitter rate limit (429)";
  posts[7].active = false;
  posts[1].interval_min = 30;
  const accounts: Account[] = [
    { id: randomUUID(), platform: "instagram", handle: "brand_official", active: true, last_error: null },
    { id: randomUUID(), platform: "youtube", handle: "BrandChannel", active: true, last_error: null },
    { id: randomUUID(), platform: "twitter", handle: "brand_x", active: true, last_error: "Profile unavailable (rate limited)" },
  ];
  const accSnaps: AccountSnap[] = [];
  accounts.forEach((a, i) => {
    let f = [12800, 3100, 5200][i];
    for (let h = 24 * 14; h >= 0; h -= 6) { f += Math.round(Math.random() * [18, 9, 6][i]); accSnaps.push({ account_id: a.id, taken_at: new Date(now - h * 36e5).toISOString(), followers: f }); }
  });
  const alerts: AlertRow[] = [
    { id: 1, created_at: new Date(now - 3 * 36e5).toISOString(), kind: "spike", message: `instagram spike: likes 5,210 -> 6,980 (+34%) ${posts[0].url}` },
    { id: 2, created_at: new Date(now - 19 * 36e5).toISOString(), kind: "spike", message: `youtube spike: views 190,400 -> 251,100 (+32%) ${posts[1].url}` },
    { id: 3, created_at: new Date(now - 30 * 36e5).toISOString(), kind: "drop", message: `twitter drop: likes 3,400 -> 2,310 (-32%) ${posts[3].url}` },
  ];
  return { posts, snaps, accounts, accSnaps, alerts, settings: { ...DEFAULT_SETTINGS } };
}
const db = (): DemoDb => (g.__demoDb ??= seedDemo());

const demoStore: Store = {
  demo: true,
  sheetUrl: null,
  async listPosts() {
    const d = db();
    return d.posts.map((p) => {
      const s = d.snaps.filter((x) => x.post_id === p.id);
      const l = s[s.length - 1];
      const hist = s.map((x) => [x.taken_at, x.likes, x.comments, x.views]);
      const latest = { likes: n(l?.likes), comments: n(l?.comments), views: n(l?.views) };
      return { ...p, last_taken_at: l?.taken_at ?? null, ...latest, shares: null, ...delta24(hist, latest), spark: sparkOf(hist.slice(-80), 1), spark_views: sparkOf(hist.slice(-80), 3) } as PostRow;
    });
  },
  async addPosts(rows, by) {
    const d = db();
    let added = 0;
    for (const r of rows) {
      if (d.posts.some((p) => p.platform === r.platform && p.external_id === r.external_id)) continue;
      d.posts.push({ id: randomUUID(), ...r, title: null, campaign: r.campaign ?? null, author: r.author ?? null, added_by: by, active: true, last_error: null, created_at: new Date().toISOString(), interval_min: null });
      added++;
    }
    return { added, skipped: rows.length - added };
  },
  async getPost(id) { return (await this.listPosts()).find((p) => p.id === id) ?? null; },
  async snapshots(id) { return db().snaps.filter((s) => s.post_id === id).map(({ post_id: _p, ...rest }) => rest); },
  async updatePost(id, patch) {
    const p = db().posts.find((x) => x.id === id);
    if (!p) throw new Error("not found");
    if (patch.campaign !== undefined) p.campaign = patch.campaign;
    if (patch.active !== undefined) p.active = patch.active;
    if (patch.interval_min !== undefined) p.interval_min = patch.interval_min;
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
  async getSettings() { return { ...db().settings }; },
  async setSettings(patch) { db().settings = { ...db().settings, ...cleanSettings(patch) }; return { ...db().settings }; },
  async overview(days) { const d = db(); return buildOverview(d.snaps.filter((s) => d.posts.some((p) => p.id === s.post_id)), days); },
  async compare(ids) { return groupSeries(db().snaps, ids); },
};

export const store: Store = sh.sheetsConfigured() ? sheetsStore : demoStore;
