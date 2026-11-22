// Pure helpers shared by the Sheets store and the demo store.
import type { Overview, OverviewPoint, Snapshot } from "../types";

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
    growth.likes += Math.max(0, clamp((last.likes ?? 0) - (base.likes ?? 0)));
    growth.comments += Math.max(0, clamp((last.comments ?? 0) - (base.comments ?? 0)));
    growth.views += Math.max(0, clamp((last.views ?? 0) - (base.views ?? 0)));
  });

  return { series, growth, days };
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
