// Pure helpers shared by the Sheets store and the demo store.
import type { Overview, OverviewPoint, PostRow, Report, ReportPost, Snapshot } from "../types";

export interface SnapRow extends Snapshot {
  post_id: string;
}

const clamp = (n: number) => (Number.isFinite(n) ? n : 0);

/** Downsample a numeric series to at most `max` points (keeps first and last). */
export function downsample(values: number[], max = 24): number[] {
  if (values.length <= max) return values;
  const out: number[] = [];
  for (let i = 0; i < max; i++) out.push(values[Math.round((i * (values.length - 1)) / (max - 1))]);
  return out;
}

/**
 * Totals across posts over time, plus "growth" = how much the posts grew since the start of the
 * range (each post's baseline is its last value before the range, or its first value inside it,
 * so adding a new post never makes the line jump).
 */
export function buildOverview(snaps: SnapRow[], days: number, buckets = 56): Overview {
  const byPost = new Map<string, SnapRow[]>();
  for (const s of snaps) {
    if (!byPost.has(s.post_id)) byPost.set(s.post_id, []);
    byPost.get(s.post_id)!.push(s);
  }
  byPost.forEach((arr) => arr.sort((a, b) => a.taken_at.localeCompare(b.taken_at)));

  const now = Date.now();
  let first = now;
  byPost.forEach((arr) => { first = Math.min(first, new Date(arr[0].taken_at).getTime()); });
  const start = days > 0 ? now - days * 864e5 : first;
  const span = Math.max(now - start, 1);

  const times: number[] = [];
  for (let i = 0; i < buckets; i++) times.push(start + (span * i) / (buckets - 1));

  const series: OverviewPoint[] = times.map((t) => ({ t, likes: 0, comments: 0, views: 0, g_likes: 0, g_comments: 0, g_views: 0 }));
  const growth = { likes: 0, comments: 0, views: 0 };
  const post_growth: Overview["post_growth"] = {};
  const prev = days > 0 ? { likes: 0, comments: 0, views: 0 } : null;
  const prevStart = start - span;

  byPost.forEach((arr) => {
    const ts = arr.map((s) => new Date(s.taken_at).getTime());
    // baseline: last snapshot at/before start, else the first snapshot
    let bi = -1;
    for (let i = 0; i < ts.length; i++) if (ts[i] <= start) bi = i;
    const base = arr[bi >= 0 ? bi : 0];
    let j = 0;
    times.forEach((t, k) => {
      while (j + 1 < ts.length && ts[j + 1] <= t) j++;
      if (ts[j] > t) return; // post has no data yet at this time
      const cur = arr[j];
      series[k].likes += clamp(cur.likes ?? 0);
      series[k].comments += clamp(cur.comments ?? 0);
      series[k].views += clamp(cur.views ?? 0);
      series[k].g_likes += Math.max(0, clamp((cur.likes ?? 0) - (base.likes ?? 0)));
      series[k].g_comments += Math.max(0, clamp((cur.comments ?? 0) - (base.comments ?? 0)));
      series[k].g_views += Math.max(0, clamp((cur.views ?? 0) - (base.views ?? 0)));
    });
    const last = arr[arr.length - 1];
    const gain = (k: "likes" | "comments" | "views") => Math.max(0, clamp((last[k] ?? 0) - (base[k] ?? 0)));
    const pg = { likes: gain("likes"), comments: gain("comments"), views: gain("views") };
    post_growth[arr[0].post_id] = pg;
    growth.likes += pg.likes;
    growth.comments += pg.comments;
    growth.views += pg.views;
    if (prev) {
      // previous period: value at its end (= our baseline) minus value at its start (or the first value inside it)
      let pi = -1;
      for (let i = 0; i < ts.length; i++) if (ts[i] <= prevStart) pi = i;
      const p0 = pi >= 0 ? arr[pi] : ts[0] <= start ? arr[0] : null;
      if (p0 && bi >= 0) {
        prev.likes += Math.max(0, clamp((base.likes ?? 0) - (p0.likes ?? 0)));
        prev.comments += Math.max(0, clamp((base.comments ?? 0) - (p0.comments ?? 0)));
        prev.views += Math.max(0, clamp((base.views ?? 0) - (p0.views ?? 0)));
      }
    }
  });

  return { series, growth, prev_growth: prev, post_growth, days };
}

export function groupSeries(snaps: SnapRow[], ids: string[]): Record<string, Snapshot[]> {
  const want = new Set(ids);
  const out: Record<string, Snapshot[]> = {};
  for (const id of ids) out[id] = [];
  for (const s of snaps) {
    if (!want.has(s.post_id)) continue;
    const { post_id: _p, ...rest } = s;
    out[s.post_id].push(rest);
  }
  for (const id of ids) out[id].sort((a, b) => a.taken_at.localeCompare(b.taken_at));
  return out;
}

/** Client report for a set of posts: totals now, growth inside the period, series and per-post numbers. */
export function buildReport(posts: PostRow[], snaps: SnapRow[], days: number, campaign: string | null, shared: boolean): Report {
  const ids = new Set(posts.map((p) => p.id));
  const mine = snaps.filter((s) => ids.has(s.post_id));
  const overview = buildOverview(mine, days, 60);
  const start = days > 0 ? Date.now() - days * 864e5 : 0;
  const byPost = new Map<string, SnapRow[]>();
  for (const s of mine) {
    if (!byPost.has(s.post_id)) byPost.set(s.post_id, []);
    byPost.get(s.post_id)!.push(s);
  }
  let first: string | null = null;
  const rows: ReportPost[] = posts.map((p) => {
    const arr = (byPost.get(p.id) ?? []).sort((a, b) => a.taken_at.localeCompare(b.taken_at));
    if (arr.length && (first === null || arr[0].taken_at < first)) first = arr[0].taken_at;
    let base: SnapRow | undefined = arr[0];
    for (const s of arr) if (new Date(s.taken_at).getTime() <= start) base = s;
    const g = (k: "likes" | "comments" | "views", cur: number | null) => (cur === null || !base ? 0 : Math.max(0, cur - (base[k] ?? cur)));
    return {
      id: p.id, platform: p.platform, url: p.url, title: p.title, author: p.author, campaign: p.campaign, thumbnail: p.thumbnail,
      created_at: p.created_at, last_taken_at: p.last_taken_at, likes: p.likes, comments: p.comments, views: p.views,
      g_likes: g("likes", p.likes), g_comments: g("comments", p.comments), g_views: g("views", p.views),
    };
  });
  rows.sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || (b.likes ?? 0) - (a.likes ?? 0));
  const sum = (k: "likes" | "comments" | "views") => rows.reduce((t, r) => t + (r[k] ?? 0), 0);
  return {
    campaign, days, generated_at: new Date().toISOString(), first_at: first, posts: rows, overview,
    totals: { likes: sum("likes"), comments: sum("comments"), views: sum("views"), posts: rows.length }, shared,
  };
}
