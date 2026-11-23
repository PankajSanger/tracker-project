"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { DEFAULT_SETTINGS } from "@/lib/types";
import type { PostRow, Settings, Snapshot } from "@/lib/types";
import { ago, delta, download, engagement, fmt, INTERVALS, intervalLabel, pct, postTitle, toCsv, viewsStale, PLATFORM_LABEL } from "@/lib/utils";
import { DeltaChip, Empty, Icon, Kpi, PlatformMark, Seg, Skeleton, useToast } from "@/components/ui";
import { AXIS, GRID, TipCard } from "@/components/charts";

type Range = "24h" | "7d" | "30d" | "90d" | "all" | "custom";
type Gran = "auto" | "raw" | "hour" | "day";
type Metric = "likes" | "comments" | "views";
const COLORS: Record<Metric, string> = { likes: "var(--likes)", comments: "var(--comments)", views: "var(--views)" };
const RANGE_MS: Record<string, number> = { "24h": 864e5, "7d": 7 * 864e5, "30d": 30 * 864e5, "90d": 90 * 864e5 };

interface Pt { t: number; likes: number | null; comments: number | null; views: number | null }

/** Keep the last snapshot of each hour/day (or every snapshot for "raw"). */
function bucketize(points: Pt[], gran: Exclude<Gran, "auto">): Pt[] {
  if (gran === "raw") return points;
  const size = gran === "hour" ? 36e5 : 864e5;
  const out = new Map<number, Pt>();
  for (const p of points) {
    const k = gran === "day" ? new Date(p.t).setHours(0, 0, 0, 0) : Math.floor(p.t / size) * size;
    out.set(k, { ...p, t: k });
  }
  return Array.from(out.values()).sort((a, b) => a.t - b.t);
}

function PostDetail() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  const { toast, show } = useToast();
  const [post, setPost] = useState<PostRow | null>(null);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [failed, setFailed] = useState(false);
  const [range, setRange] = useState<Range>("7d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [mode, setMode] = useState<"total" | "growth">("total");
  const [gran, setGran] = useState<Gran>("auto");
  const [metrics, setMetrics] = useState<Set<Metric>>(new Set(["likes", "views"]));
  const [campaign, setCampaign] = useState("");

  const load = () => {
    if (!id) return;
    Promise.all([api.post(id), api.settings().catch(() => DEFAULT_SETTINGS)])
      .then(([{ post, snapshots }, s]) => {
        setPost(post); setCampaign(post.campaign ?? ""); setSettings(s);
        setSnaps([...snapshots].sort((a, b) => a.taken_at.localeCompare(b.taken_at)));
      }).catch(() => setFailed(true));
  };
  useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const points = useMemo(() => {
    const all: Pt[] = snaps.map((s) => ({ t: new Date(s.taken_at).getTime(), likes: s.likes, comments: s.comments, views: s.views }));
    let lo = 0, hi = Infinity;
    if (range === "custom") {
      lo = from ? new Date(from + "T00:00:00").getTime() : 0;
      hi = to ? new Date(to + "T23:59:59").getTime() : Infinity;
    } else if (range !== "all") lo = Date.now() - RANGE_MS[range];
    const f = all.filter((p) => p.t >= lo && p.t <= hi);
    const span = f.length ? f[f.length - 1].t - f[0].t : 0;
    const g: Exclude<Gran, "auto"> = gran === "auto" ? (span <= 2 * 864e5 ? "raw" : span <= 21 * 864e5 ? "hour" : "day") : gran;
    return bucketize(f, g);
  }, [snaps, range, from, to, gran]);

  const chartData = useMemo(() => {
    if (mode === "total") return points;
    return points.slice(1).map((p, i) => ({
      t: p.t,
      likes: p.likes !== null && points[i].likes !== null ? Math.max(0, p.likes - (points[i].likes as number)) : null,
      comments: p.comments !== null && points[i].comments !== null ? Math.max(0, p.comments - (points[i].comments as number)) : null,
      views: p.views !== null && points[i].views !== null ? Math.max(0, p.views - (points[i].views as number)) : null,
    }));
  }, [points, mode]);

  const gained = (k: Metric) => (points.length >= 2 && points[points.length - 1][k] !== null && points[0][k] !== null ? (points[points.length - 1][k] as number) - (points[0][k] as number) : null);
  const toggleMetric = (m: Metric) => setMetrics((s) => { const n = new Set(s); if (n.has(m)) { if (n.size > 1) n.delete(m); } else n.add(m); return n; });

  const rows = useMemo(() => [...snaps].reverse().slice(0, 100).map((s, i, arr) => {
    const prev = arr[i + 1];
    const d = (a: number | null, b: number | null | undefined) => (a !== null && b !== null && b !== undefined ? a - b : null);
    return { ...s, dl: d(s.likes, prev?.likes), dv: d(s.views, prev?.views) };
  }), [snaps]);

  async function patch(p: { campaign?: string | null; active?: boolean; interval_min?: number | null }, msg: string) {
    if (!post) return;
    try { await api.updatePost(post.id, p); show(msg); load(); } catch (e) { show(e instanceof Error ? e.message : "Update failed"); }
  }

  if (!id) return <p>Missing post id.</p>;
  if (failed) return <div className="card"><Empty icon="alert" title="Could not load this post">It may have been deleted. <Link href="/posts" className="up">Back to posts</Link></Empty></div>;
  if (!post) return <div className="grid"><Skeleton h={44} w={420} /><div className="grid kpis">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={110} />)}</div><Skeleton h={360} /></div>;

  const defInterval = (settings as unknown as Record<string, number>)[`interval_${post.platform}`];
  const effective = post.interval_min ?? defInterval;
  const enabled = (["likes", "comments", "views"] as Metric[]).filter((m) => metrics.has(m) && (m !== "views" || post.views !== null || points.some((p) => p.views)));
  const hasRight = enabled.includes("views");
  const left = enabled.filter((m) => m !== "views");
  const xFmt = (t: number) => new Date(t).toLocaleString(undefined, points.length > 1 && points[points.length - 1].t - points[0].t <= 2 * 864e5 ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" });
  const tip = (active: boolean | undefined, payload: readonly any[] | undefined) =>
    active && payload?.length ? (
      <TipCard title={new Date(payload[0].payload.t).toLocaleString()}
        rows={payload.filter((p) => p.value !== null).map((p) => ({ label: `${mode === "growth" ? "+" : ""}${p.dataKey}`, value: Number(p.value).toLocaleString(), color: COLORS[p.dataKey as Metric] }))} />
    ) : null;

  return (
    <>
      <div className="page-head">
        <Link href="/posts" className="btn icon ghost" title="Back"><Icon name="arrowleft" size={16} /></Link>
        <PlatformMark platform={post.platform} size={38} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ fontSize: 20, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{postTitle(post)}</h1>
          <div className="sub" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span>{PLATFORM_LABEL[post.platform]}{post.author ? ` · ${post.author}` : ""}</span>
            {post.campaign && <span className="tag">{post.campaign}</span>}
            {post.added_by && <span>added by {post.added_by.split("@")[0]}</span>}
            <span className={`chip ${post.active ? (post.last_error ? "warn" : "up") : ""}`}>{post.active ? (post.last_error ? "needs attention" : "tracking") : "paused"}</span>
          </div>
        </div>
        <button className="btn" onClick={async () => { try { await api.checkNow(post.id); show("Queued - fresh numbers within about 5 minutes."); } catch (e) { show(e instanceof Error ? e.message : "Could not queue"); } }}><Icon name="refresh" size={15} /> Check now</button>
        <a href={post.url} target="_blank" rel="noreferrer" className="btn"><Icon name="external" size={15} /> Open post</a>
        <button className="btn danger" title="Delete this post" onClick={async () => {
          if (!confirm("Delete this post from the tracker? Its history stays in the Google Sheet but the dashboard will no longer show it.")) return;
          await api.deletePost(post.id);
          router.push("/posts");
        }}><Icon name="trash" size={15} /> Delete</button>
      </div>

      {post.last_error && <div className="banner"><Icon name="alert" /> Last check failed: {post.last_error}</div>}

      <div className="grid kpis">
        <Kpi label="Views" icon="eye" color="var(--views)" value={fmt(post.views)} spark={post.spark_views} foot={viewsStale(post) ? <span title="Instagram only shows view counts on a creator's recent reels, so this is the last number seen">last seen {ago(post.views_at)}</span> : post.views === null && post.platform === "instagram" ? <span>not shown by Instagram</span> : <DeltaChip value={post.views_24h} suffix=" /24h" />} />
        <Kpi label="Likes" icon="heart" color="var(--likes)" value={fmt(post.likes)} spark={post.spark} foot={<DeltaChip value={post.likes_24h} suffix=" /24h" />} />
        <Kpi label="Comments" icon="message" color="var(--comments)" value={fmt(post.comments)} foot={<DeltaChip value={post.comments_24h} suffix=" /24h" />} />
        <Kpi label="Engagement" icon="zap" color="#f59e0b" value={pct(engagement(post), 2)} foot={<span>checked {ago(post.last_taken_at)} · every {intervalLabel(effective)}</span>} />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head" style={{ flexWrap: "wrap" }}>
          <h2>Performance</h2>
          <span className="grow" />
          <Seg value={mode} onChange={setMode} options={[{ value: "total", label: "Total" }, { value: "growth", label: "Growth" }]} />
          <Seg value={gran} onChange={setGran} options={[{ value: "auto", label: "Auto" }, { value: "raw", label: "Each check" }, { value: "hour", label: "Hourly" }, { value: "day", label: "Daily" }]} />
        </div>
        <div className="toolbar" style={{ marginBottom: 8 }}>
          <Seg value={range} onChange={setRange} options={[{ value: "24h", label: "24h" }, { value: "7d", label: "7d" }, { value: "30d", label: "30d" }, { value: "90d", label: "90d" }, { value: "all", label: "All" }, { value: "custom", label: "Custom" }]} />
          {range === "custom" && (
            <>
              <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
              <span className="muted">to</span>
              <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
            </>
          )}
          <span className="grow" />
          <div className="pills">
            {(["likes", "comments", "views"] as Metric[]).map((m) => (
              <button key={m} className={`pill ${metrics.has(m) ? "on" : ""}`} onClick={() => toggleMetric(m)}>
                <i style={{ width: 9, height: 9, borderRadius: 3, background: COLORS[m], display: "inline-block" }} /> {m}
                {gained(m) !== null && <span className="n">{delta(gained(m))}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="chart-box">
          {chartData.length < 2 ? <Empty icon="clock" title="Not enough data in this range yet">Try a longer range, or wait for the next check.</Empty> : (
            <ResponsiveContainer>
              {mode === "total" ? (
                <LineChart data={chartData} margin={{ left: 0, right: 0, top: 8 }}>
                  <CartesianGrid {...GRID} vertical={false} />
                  <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tick={AXIS} axisLine={false} tickLine={false} minTickGap={50} tickFormatter={xFmt} />
                  <YAxis yAxisId="l" tick={AXIS} axisLine={false} tickLine={false} width={48} tickFormatter={fmt} hide={!left.length} domain={["auto", "auto"]} />
                  <YAxis yAxisId="r" orientation="right" tick={AXIS} axisLine={false} tickLine={false} width={52} tickFormatter={fmt} hide={!hasRight} domain={["auto", "auto"]} />
                  <Tooltip content={({ active, payload }) => tip(active, payload)} />
                  {enabled.map((m) => <Line key={m} yAxisId={m === "views" ? "r" : "l"} type="monotone" dataKey={m} stroke={COLORS[m]} strokeWidth={2.4} dot={chartData.length < 40 ? { r: 2.5 } : false} connectNulls isAnimationActive={false} />)}
                </LineChart>
              ) : (
                <BarChart data={chartData} margin={{ left: 0, right: 0, top: 8 }}>
                  <CartesianGrid {...GRID} vertical={false} />
                  <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tick={AXIS} axisLine={false} tickLine={false} minTickGap={50} tickFormatter={xFmt} />
                  <YAxis yAxisId="l" tick={AXIS} axisLine={false} tickLine={false} width={48} tickFormatter={fmt} hide={!left.length} />
                  <YAxis yAxisId="r" orientation="right" tick={AXIS} axisLine={false} tickLine={false} width={52} tickFormatter={fmt} hide={!hasRight} />
                  <Tooltip cursor={{ fill: "var(--accent-soft)" }} content={({ active, payload }) => tip(active, payload)} />
                  {enabled.map((m) => <Bar key={m} yAxisId={m === "views" ? "r" : "l"} dataKey={m} fill={COLORS[m]} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />)}
                </BarChart>
              )}
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid halves" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-head"><h2>Tracking</h2></div>
          <div className="form-grid">
            <label>
              Check this post every
              <select className="select" value={post.interval_min ?? 0} onChange={(e) => patch({ interval_min: Number(e.target.value) || null }, "Interval updated")}>
                <option value={0}>Platform default ({intervalLabel(defInterval)})</option>
                {INTERVALS.map((m) => <option key={m} value={m}>{intervalLabel(m)}</option>)}
              </select>
              <small>Applies from the next scheduled check.</small>
            </label>
            <label>
              Campaign
              <div style={{ display: "flex", gap: 8 }}>
                <input className="input" style={{ flex: 1 }} value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="e.g. Launch" />
                <button className="btn" onClick={() => patch({ campaign }, "Campaign saved")}><Icon name="save" size={14} /></button>
              </div>
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <button className="btn" onClick={() => patch({ active: !post.active }, post.active ? "Tracking paused" : "Tracking resumed")}>
              <Icon name={post.active ? "pause" : "play"} size={14} /> {post.active ? "Pause tracking" : "Resume tracking"}
            </button>
            <button className="btn danger" onClick={async () => {
              if (!confirm("Delete this post from the tracker? Its history stays in the Google Sheet but the dashboard will no longer show it.")) return;
              await api.deletePost(post.id);
              router.push("/posts");
            }}><Icon name="trash" size={14} /> Delete</button>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>In this range</h2></div>
          <div className="list">
            {(["views", "likes", "comments"] as Metric[]).map((m) => (
              <div className="list-item" key={m}>
                <i style={{ width: 10, height: 10, borderRadius: 3, background: COLORS[m] }} />
                <div className="grow" style={{ textTransform: "capitalize" }}>{m} gained</div>
                <DeltaChip value={gained(m)} />
              </div>
            ))}
            <div className="list-item"><Icon name="clock" size={14} /><div className="grow">Data points</div><b>{points.length}</b></div>
          </div>
        </div>
      </div>

      <div className="card flush">
        <div className="card-head" style={{ padding: "16px 18px 0" }}>
          <h2>Snapshot history</h2><span className="muted small">latest 100 of {snaps.length}</span><span className="grow" />
          <button className="btn sm" onClick={() => download(`snapshots-${post.external_id}.csv`, toCsv(snaps as unknown as Record<string, unknown>[]))}><Icon name="download" size={13} /> CSV</button>
        </div>
        <div className="table-wrap" style={{ maxHeight: 420 }}>
          <table>
            <thead><tr><th className="l">Time</th><th>Likes</th><th>Δ</th><th>Comments</th><th>Views</th><th>Δ</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.taken_at}>
                  <td className="l">{new Date(s.taken_at).toLocaleString()}</td>
                  <td>{fmt(s.likes)}</td><td className={(s.dl ?? 0) >= 0 ? "up" : "down"}>{delta(s.dl)}</td>
                  <td>{fmt(s.comments)}</td>
                  <td>{fmt(s.views)}</td><td className={(s.dv ?? 0) >= 0 ? "up" : "down"}>{delta(s.dv)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="muted l">No snapshots yet. The first check will appear here.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {toast}
    </>
  );
}

export default function Page() {
  return <Suspense fallback={<Skeleton h={300} />}><PostDetail /></Suspense>;
}
