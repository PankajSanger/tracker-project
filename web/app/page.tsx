"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { usePosts } from "@/lib/hooks";
import type { Overview as OverviewData } from "@/lib/types";
import { ago, effectiveInterval, engagement, fmt, isStale, pct, postTitle, PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/utils";
import { DeltaChip, Empty, Icon, Kpi, PlatformMark, Seg, Skeleton, Sparkline, useToast } from "@/components/ui";
import { AXIS, GRID, TipCard } from "@/components/charts";

const METRIC_COLOR = { views: "var(--views)", likes: "var(--likes)", comments: "var(--comments)" } as const;
type Metric = keyof typeof METRIC_COLOR;

export default function OverviewPage() {
  const { posts, settings, error, reload } = usePosts();
  const [days, setDays] = useState(7);
  const [ov, setOv] = useState<OverviewData | null>(null);
  const [metric, setMetric] = useState<Metric>("views");
  const [mode, setMode] = useState<"growth" | "total">("growth");
  const [urls, setUrls] = useState("");
  const { toast, show } = useToast();

  useEffect(() => {
    setOv(null);
    api.overview(days).then(setOv).catch(() => setOv({ series: [], growth: { likes: 0, comments: 0, views: 0 }, days }));
  }, [days]);

  const active = useMemo(() => (posts ?? []).filter((p) => p.active), [posts]);
  const totals = useMemo(() => {
    const sum = (k: "likes" | "comments" | "views") => active.reduce((t, p) => t + (p[k] ?? 0), 0);
    const withViews = active.filter((p) => p.views);
    const eng = withViews.length ? (withViews.reduce((t, p) => t + (p.likes ?? 0) + (p.comments ?? 0), 0) / withViews.reduce((t, p) => t + (p.views ?? 0), 0)) * 100 : null;
    return { likes: sum("likes"), comments: sum("comments"), views: sum("views"), eng };
  }, [active]);

  const defaults = settings as unknown as Record<string, number>;
  const needsAttention = useMemo(() => active.filter((p) => p.last_error || isStale(p, effectiveInterval(p, defaults))), [active, defaults]);
  const growing = useMemo(() => [...active].filter((p) => (p.likes_24h ?? 0) > 0).sort((a, b) => (b.likes_24h ?? 0) - (a.likes_24h ?? 0)).slice(0, 5), [active]);
  const top = useMemo(() => [...active].sort((a, b) => (b.views ?? b.likes ?? 0) - (a.views ?? a.likes ?? 0)).slice(0, 5), [active]);

  const byPlatform = useMemo(() => {
    const out = (["instagram", "youtube", "twitter"] as const).map((pf) => {
      const ps = active.filter((p) => p.platform === pf);
      return { pf, count: ps.length, likes: ps.reduce((t, p) => t + (p.likes ?? 0), 0), views: ps.reduce((t, p) => t + (p.views ?? 0), 0) };
    }).filter((x) => x.count);
    const total = out.reduce((t, x) => t + x.likes, 0) || 1;
    return out.map((x) => ({ ...x, share: (x.likes / total) * 100 }));
  }, [active]);

  const series = ov?.series ?? [];
  const spark = (k: Metric) => series.map((s) => s[k]);
  const gain = (k: Metric) => (ov ? ov.growth[k] : null);
  const chartKey = mode === "growth" ? (`g_${metric}` as const) : metric;
  const periodLabel = days === 1 ? "24h" : days === 0 ? "all time" : `${days}d`;

  async function quickAdd() {
    try {
      const r = await api.addPosts(urls.split(/\s+/).filter(Boolean), "");
      show(`Added ${r.added} post(s)${r.skipped ? `, ${r.skipped} already tracked` : ""}${r.bad.length ? `, ${r.bad.length} not recognised` : ""}. Numbers appear after the next check.`);
      setUrls("");
      reload();
    } catch (e) { show(e instanceof Error ? e.message : "Could not add"); }
  }

  if (posts === null)
    return (
      <div className="grid">
        <Skeleton h={40} w={260} />
        <div className="grid kpis">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={118} />)}</div>
        <Skeleton h={340} />
      </div>
    );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <div className="sub">{active.length} active posts across {byPlatform.length} platform{byPlatform.length === 1 ? "" : "s"}{error ? <span className="err"> · {error}</span> : null}</div>
        </div>
        <div className="grow" />
        <Seg value={days} onChange={setDays} options={[{ value: 1, label: "24h" }, { value: 7, label: "7d" }, { value: 30, label: "30d" }, { value: 0, label: "All" }]} />
      </div>

      <div className="card" style={{ marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", padding: 12 }}>
        <div className="field" style={{ flex: 1, minWidth: 240 }}>
          <span className="ico-in"><Icon name="plus" size={16} /></span>
          <input className="input search" style={{ width: "100%" }} placeholder="Track new posts: paste Instagram, YouTube or X links" value={urls} onChange={(e) => setUrls(e.target.value)} onKeyDown={(e) => e.key === "Enter" && urls.trim() && quickAdd()} />
        </div>
        <button className="btn primary" onClick={quickAdd} disabled={!urls.trim()}>Track</button>
      </div>

      {posts.length === 0 ? (
        <div className="card"><Empty icon="trend" title="Nothing tracked yet">Paste a post link above to start tracking likes, comments and views.</Empty></div>
      ) : (
        <>
          <div className="grid kpis">
            <Kpi label="Views" icon="eye" color="var(--views)" value={fmt(totals.views)} spark={spark("views")}
              foot={<><DeltaChip value={gain("views")} /> <span>last {periodLabel}</span></>} />
            <Kpi label="Likes" icon="heart" color="var(--likes)" value={fmt(totals.likes)} spark={spark("likes")}
              foot={<><DeltaChip value={gain("likes")} /> <span>last {periodLabel}</span></>} />
            <Kpi label="Comments" icon="message" color="var(--comments)" value={fmt(totals.comments)} spark={spark("comments")}
              foot={<><DeltaChip value={gain("comments")} /> <span>last {periodLabel}</span></>} />
            <Kpi label="Engagement" icon="zap" color="var(--eng)" value={pct(totals.eng, 2)} foot={<span>likes + comments per view</span>} />
            <Kpi label="Tracked posts" icon="layers" color="var(--accent)" value={active.length}
              foot={needsAttention.length ? <span className="chip warn"><Icon name="alert" size={11} /> {needsAttention.length} need attention</span> : <span className="chip up"><Icon name="check" size={11} /> all healthy</span>} />
          </div>

          <div className="grid two" style={{ marginBottom: 14 }}>
            <div className="card">
              <div className="card-head">
                <h2>{mode === "growth" ? "Growth" : "Totals"} over time</h2>
                <span className="grow" />
                <Seg value={mode} onChange={setMode} options={[{ value: "growth", label: "Growth" }, { value: "total", label: "Total" }]} />
                <Seg value={metric} onChange={setMetric} options={[{ value: "views", label: "Views" }, { value: "likes", label: "Likes" }, { value: "comments", label: "Comments" }]} />
              </div>
              <div className="chart-box">
                {ov === null ? <Skeleton h={320} /> : series.length < 2 || series.every((s) => s[chartKey] === 0) ? (
                  <Empty icon="clock" title="Collecting data">The chart fills in as the tracker takes more snapshots.</Empty>
                ) : (
                  <ResponsiveContainer>
                    <AreaChart data={series} margin={{ left: 0, right: 8, top: 8 }}>
                      <defs>
                        <linearGradient id="ovg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0" stopColor={METRIC_COLOR[metric]} stopOpacity={0.35} />
                          <stop offset="1" stopColor={METRIC_COLOR[metric]} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...GRID} vertical={false} />
                      <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tick={AXIS} axisLine={false} tickLine={false} minTickGap={48}
                        tickFormatter={(t) => new Date(t).toLocaleString(undefined, days === 1 ? { hour: "numeric" } : { month: "short", day: "numeric" })} />
                      <YAxis tick={AXIS} axisLine={false} tickLine={false} width={46} tickFormatter={fmt} />
                      <Tooltip cursor={{ stroke: "var(--border)" }} content={({ active: a, payload }) => a && payload?.length ? (
                        <TipCard title={new Date(payload[0].payload.t).toLocaleString()} rows={[{ label: mode === "growth" ? `${metric} gained` : metric, value: (payload[0].value as number).toLocaleString(), color: METRIC_COLOR[metric] }]} />
                      ) : null} />
                      <Area type="monotone" dataKey={chartKey} stroke={METRIC_COLOR[metric]} strokeWidth={2.4} fill="url(#ovg)" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h2>By platform</h2></div>
              <div style={{ display: "flex", height: 10, borderRadius: 99, overflow: "hidden", marginBottom: 16, background: "var(--surface-2)" }}>
                {byPlatform.map((x) => <i key={x.pf} title={`${PLATFORM_LABEL[x.pf]} ${x.share.toFixed(0)}%`} style={{ width: `${x.share}%`, background: PLATFORM_COLOR[x.pf] }} />)}
              </div>
              <div className="list">
                {byPlatform.map((x) => (
                  <div className="list-item" key={x.pf}>
                    <PlatformMark platform={x.pf} size={30} />
                    <div className="grow">
                      <div className="t">{PLATFORM_LABEL[x.pf]}</div>
                      <div className="muted small">{x.count} post{x.count > 1 ? "s" : ""} · {x.share.toFixed(0)}% of likes</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700 }}>{fmt(x.likes)} <span className="muted small">likes</span></div>
                      <div className="muted small">{x.views ? `${fmt(x.views)} views` : "no view data"}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid thirds">
            <div className="card">
              <div className="card-head"><span className="chip up"><Icon name="trend" size={12} /></span><h2>Fastest growing (24h)</h2></div>
              {growing.length === 0 ? <div className="muted">Needs a full day of history.</div> : (
                <div className="list">
                  {growing.map((p, i) => (
                    <Link href={`/post?id=${p.id}`} className="list-item" key={p.id}>
                      <span className="rank">{i + 1}</span>
                      <div className="grow"><div className="t">{postTitle(p)}</div><div className="muted small">{PLATFORM_LABEL[p.platform]}</div></div>
                      <Sparkline values={p.spark} color="var(--good)" width={64} height={26} />
                      <DeltaChip value={p.likes_24h} />
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-head"><span className="chip accent"><Icon name="zap" size={12} /></span><h2>Top performing</h2></div>
              <div className="list">
                {top.map((p, i) => (
                  <Link href={`/post?id=${p.id}`} className="list-item" key={p.id}>
                    <span className="rank">{i + 1}</span>
                    <div className="grow"><div className="t">{postTitle(p)}</div><div className="muted small">{PLATFORM_LABEL[p.platform]} · {pct(engagement(p), 1)} engagement</div></div>
                    <div style={{ fontWeight: 700, textAlign: "right" }}>{fmt(p.views ?? p.likes)}<div className="muted small" style={{ fontWeight: 400 }}>{p.views ? "views" : "likes"}</div></div>
                  </Link>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-head"><span className={`chip ${needsAttention.length ? "warn" : "up"}`}><Icon name={needsAttention.length ? "alert" : "check"} size={12} /></span><h2>Needs attention</h2></div>
              {needsAttention.length === 0 ? <div className="muted">Everything is being tracked normally.</div> : (
                <div className="list">
                  {needsAttention.slice(0, 5).map((p) => (
                    <Link href={`/post?id=${p.id}`} className="list-item" key={p.id}>
                      <PlatformMark platform={p.platform} size={26} />
                      <div className="grow"><div className="t">{postTitle(p)}</div><div className="small" style={{ color: "var(--warn)" }}>{p.last_error ? p.last_error.slice(0, 70) : `no new data since ${ago(p.last_taken_at)}`}</div></div>
                    </Link>
                  ))}
                  {needsAttention.length > 5 && <div className="muted small" style={{ paddingTop: 10 }}>+{needsAttention.length - 5} more on the Posts page</div>}
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {toast}
    </>
  );
}
