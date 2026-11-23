"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { usePosts } from "@/lib/hooks";
import type { Account, AccountSnap, Overview as OverviewData, PostRow } from "@/lib/types";
import { ago, delta, effectiveInterval, engagement, fmt, isStale, pct, postTitle, PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/utils";
import { Empty, Icon, Kpi, PlatformMark, Seg, Skeleton, Thumb, useToast } from "@/components/ui";
import { AXIS, GRID, TipCard } from "@/components/charts";

const METRIC_COLOR = { views: "var(--views)", likes: "var(--likes)", comments: "var(--comments)" } as const;
type Metric = keyof typeof METRIC_COLOR;
const EMPTY_OV = (days: number): OverviewData => ({ series: [], growth: { likes: 0, comments: 0, views: 0 }, prev_growth: null, post_growth: {}, days });
const isAuto = (p: PostRow) => (p.added_by ?? "").startsWith("auto:");

/** "+12% vs previous 7d" chip: compares growth in this period with the one before. */
function VsPrev({ cur, prev, label }: { cur: number; prev: number | null | undefined; label: string }) {
  if (prev === null || prev === undefined) return null;
  if (prev === 0) return cur > 0 ? <span className="chip up" title={`nothing gained in the previous ${label}`}>new</span> : null;
  const p = ((cur - prev) / prev) * 100;
  return <span className={`chip ${p >= 0 ? "up" : "down"}`} title={`gained ${prev.toLocaleString()} in the previous ${label}`}><Icon name={p >= 0 ? "arrowup" : "arrowdown"} size={10} stroke={2.6} />{Math.abs(p) >= 999 ? ">999" : Math.abs(p).toFixed(0)}% vs prev</span>;
}

export default function OverviewPage() {
  const { posts, settings, error, reload } = usePosts();
  const [days, setDays] = useState(7);
  const [ov, setOv] = useState<OverviewData | null>(null);
  const [metric, setMetric] = useState<Metric>("views");
  const [mode, setMode] = useState<"growth" | "total">("growth");
  const [topBy, setTopBy] = useState<"gains" | "best">("gains");
  const [urls, setUrls] = useState("");
  const [acc, setAcc] = useState<{ accounts: Account[]; snaps: AccountSnap[] } | null>(null);
  const { toast, show } = useToast();

  useEffect(() => {
    setOv(null);
    api.overview(days).then(setOv).catch(() => setOv(EMPTY_OV(days)));
  }, [days]);
  useEffect(() => { api.accounts().then(setAcc).catch(() => setAcc({ accounts: [], snaps: [] })); }, []);

  const active = useMemo(() => (posts ?? []).filter((p) => p.active), [posts]);
  const totals = useMemo(() => {
    const sum = (k: "likes" | "comments" | "views") => active.reduce((t, p) => t + (p[k] ?? 0), 0);
    const withViews = active.filter((p) => p.views);
    const eng = withViews.length ? (withViews.reduce((t, p) => t + (p.likes ?? 0) + (p.comments ?? 0), 0) / withViews.reduce((t, p) => t + (p.views ?? 0), 0)) * 100 : null;
    return { likes: sum("likes"), comments: sum("comments"), views: sum("views"), eng };
  }, [active]);

  const defaults = settings as unknown as Record<string, number>;
  const needsAttention = useMemo(() => active.filter((p) => p.last_error || isStale(p, effectiveInterval(p, defaults))), [active, defaults]);
  const lastUpdate = useMemo(() => active.reduce<string | null>((m, p) => (p.last_taken_at && (!m || p.last_taken_at > m) ? p.last_taken_at : m), null), [active]);
  const since = days > 0 ? Date.now() - days * 864e5 : 0;
  const autoNew = useMemo(() => (posts ?? []).filter((p) => isAuto(p) && new Date(p.created_at).getTime() >= since).length, [posts, since]);

  const pg = ov?.post_growth ?? {};
  const score = (p: PostRow) => (p.views !== null ? p.views : p.likes ?? 0);
  const gainOf = (p: PostRow) => { const g = pg[p.id]; return g ? (p.views !== null ? g.views : g.likes) : 0; };
  const topContent = useMemo(() => {
    const list = [...active];
    if (topBy === "gains") return list.filter((p) => gainOf(p) > 0).sort((a, b) => gainOf(b) - gainOf(a)).slice(0, 4);
    return list.sort((a, b) => score(b) - score(a)).slice(0, 4);
  }, [active, topBy, ov]); // eslint-disable-line react-hooks/exhaustive-deps

  const byPlatform = useMemo(() => {
    const out = (["instagram", "youtube", "twitter"] as const).map((pf) => {
      const ps = active.filter((p) => p.platform === pf);
      return { pf, count: ps.length, likes: ps.reduce((t, p) => t + (p.likes ?? 0), 0), views: ps.reduce((t, p) => t + (p.views ?? 0), 0) };
    }).filter((x) => x.count);
    const total = out.reduce((t, x) => t + x.likes, 0) || 1;
    return out.map((x) => ({ ...x, share: (x.likes / total) * 100 }));
  }, [active]);

  const campaigns = useMemo(() => {
    const m = new Map<string, { name: string; posts: number; views: number; likes: number; gain: number; gainViews: boolean }>();
    for (const p of active) {
      const name = p.campaign || "";
      if (!name) continue;
      const r = m.get(name) ?? { name, posts: 0, views: 0, likes: 0, gain: 0, gainViews: false };
      r.posts++; r.views += p.views ?? 0; r.likes += p.likes ?? 0;
      const g = pg[p.id];
      if (g) { r.gain += g.views || g.likes; r.gainViews ||= g.views > 0; }
      m.set(name, r);
    }
    return Array.from(m.values()).sort((a, b) => b.gain - a.gain || b.views - a.views).slice(0, 5);
  }, [active, ov]); // eslint-disable-line react-hooks/exhaustive-deps

  const audience = useMemo(() => {
    if (!acc) return null;
    const by = new Map<string, AccountSnap[]>();
    [...acc.snaps].sort((a, b) => a.taken_at.localeCompare(b.taken_at)).forEach((s) => { if (!by.has(s.account_id)) by.set(s.account_id, []); by.get(s.account_id)!.push(s); });
    const rows = acc.accounts.filter((a) => a.active).map((a) => {
      const s = (by.get(a.id) ?? []).filter((x) => x.followers !== null);
      const last = s[s.length - 1], prev = s[s.length - 2];
      return { a, followers: last?.followers ?? null, change: last && prev ? (last.followers as number) - (prev.followers as number) : null };
    });
    return { rows: rows.sort((x, y) => (y.followers ?? 0) - (x.followers ?? 0)), total: rows.reduce((t, r) => t + (r.followers ?? 0), 0) };
  }, [acc]);

  const series = ov?.series ?? [];
  const spark = (k: Metric) => series.map((s) => s[k]);
  const gain = (k: Metric) => (ov ? ov.growth[k] : null);
  const chartKey = mode === "growth" ? (`g_${metric}` as const) : metric;
  const periodLabel = days === 1 ? "24h" : days === 0 ? "all time" : `${days}d`;
  const prevLabel = days === 1 ? "24h" : `${days} days`;

  const kpiFoot = (k: Metric) => (
    <>
      <span className={`chip ${(gain(k) ?? 0) > 0 ? "up" : ""}`}>{gain(k) === null ? "…" : `+${fmt(gain(k))}`}</span>
      {ov && <VsPrev cur={ov.growth[k]} prev={ov.prev_growth?.[k]} label={prevLabel} />}
      {!ov?.prev_growth && <span>{days === 0 ? "all time" : `last ${periodLabel}`}</span>}
    </>
  );

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
          <div className="sub ov-sub">
            <span>{active.length} active post{active.length === 1 ? "" : "s"} · {byPlatform.length} platform{byPlatform.length === 1 ? "" : "s"}</span>
            {lastUpdate && <span className="live"><i />updated {ago(lastUpdate)}</span>}
            {autoNew > 0 && <Link href="/autotrack" className="chip accent"><Icon name="zap" size={11} /> {autoNew} new post{autoNew === 1 ? "" : "s"} auto-tracked</Link>}
            {error ? <span className="err">{error}</span> : null}
          </div>
        </div>
        <div className="grow" />
        <Seg value={days} onChange={setDays} options={[{ value: 1, label: "24h" }, { value: 7, label: "7d" }, { value: 30, label: "30d" }, { value: 0, label: "All" }]} />
      </div>

      <div className="card quick-add">
        <div className="field" style={{ flex: 1, minWidth: 240 }}>
          <span className="ico-in"><Icon name="plus" size={16} /></span>
          <input className="input search" style={{ width: "100%" }} placeholder="Track new posts: paste Instagram, YouTube or X links" value={urls} onChange={(e) => setUrls(e.target.value)} onKeyDown={(e) => e.key === "Enter" && urls.trim() && quickAdd()} />
        </div>
        <button className="btn primary" onClick={quickAdd} disabled={!urls.trim()}>Track</button>
        <Link href="/autotrack" className="btn ghost"><Icon name="zap" size={15} /> Auto-track an account</Link>
      </div>

      {posts.length === 0 ? (
        <div className="card"><Empty icon="trend" title="Nothing tracked yet">Paste a post link above, or <Link href="/autotrack" className="up">auto-track an account</Link> to add its new posts automatically.</Empty></div>
      ) : (
        <>
          <div className="grid kpis">
            <Kpi label="Views" icon="eye" color="var(--views)" value={fmt(totals.views)} spark={spark("views")} foot={kpiFoot("views")} />
            <Kpi label="Likes" icon="heart" color="var(--likes)" value={fmt(totals.likes)} spark={spark("likes")} foot={kpiFoot("likes")} />
            <Kpi label="Comments" icon="message" color="var(--comments)" value={fmt(totals.comments)} spark={spark("comments")} foot={kpiFoot("comments")} />
            <Kpi label="Engagement" icon="zap" color="var(--eng)" value={pct(totals.eng, 2)} foot={<span>likes + comments per view</span>} />
            <Kpi label="Tracked posts" icon="layers" color="var(--accent)" value={active.length}
              foot={needsAttention.length ? <span className="chip warn"><Icon name="alert" size={11} /> {needsAttention.length} need attention</span> : <span className="chip up"><Icon name="check" size={11} /> all healthy</span>} />
          </div>

          <div className="grid two" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-head" style={{ flexWrap: "wrap" }}>
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
                          <stop offset="0" stopColor={METRIC_COLOR[metric]} stopOpacity={0.3} />
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
              <div className="card-head"><h2>By platform</h2><span className="grow" /><span className="muted small">share of likes</span></div>
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
                      <div style={{ fontWeight: 700 }}>{fmt(x.views || x.likes)} <span className="muted small">{x.views ? "views" : "likes"}</span></div>
                      <div className="muted small">{fmt(x.likes)} likes</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <h2>Top content</h2>
              <span className="muted small">{topBy === "gains" ? `biggest gains, last ${periodLabel}` : "highest totals"}</span>
              <span className="grow" />
              <Seg value={topBy} onChange={setTopBy} options={[{ value: "gains", label: "Biggest gains" }, { value: "best", label: "All-time best" }]} />
            </div>
            {topContent.length === 0 ? <div className="muted">{ov === null ? "Loading…" : "No growth recorded in this period yet."}</div> : (
              <div className="top-grid">
                {topContent.map((p, i) => (
                  <Link href={`/post?id=${p.id}`} className="top-card" key={p.id}>
                    <div className="top-media">
                      {p.thumbnail ? <TopImg src={p.thumbnail} platform={p.platform} /> : <div className="top-fallback"><PlatformMark platform={p.platform} size={40} /></div>}
                      <span className="top-rank">#{i + 1}</span>
                      <span className="top-pf"><PlatformMark platform={p.platform} size={22} /></span>
                    </div>
                    <div className="top-body">
                      <div className="top-title">{postTitle(p)}</div>
                      <div className="muted small">{p.author ? (p.platform === "youtube" ? p.author : `@${p.author.replace(/^@/, "")}`) : PLATFORM_LABEL[p.platform]}{p.campaign ? ` · ${p.campaign}` : ""}</div>
                      <div className="top-stats">
                        <div><b>{fmt(score(p))}</b><span>{p.views !== null ? "views" : "likes"}</span></div>
                        <div><b className="up">+{fmt(gainOf(p))}</b><span>last {periodLabel}</span></div>
                        <div><b>{pct(engagement(p), 1)}</b><span>eng.</span></div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="grid thirds">
            <div className="card">
              <div className="card-head"><span className="chip accent"><Icon name="layers" size={12} /></span><h2>Campaigns</h2><span className="grow" /><Link href="/reports" className="muted small">Reports →</Link></div>
              {campaigns.length === 0 ? <div className="muted">Give posts a campaign name to compare campaigns here.</div> : (
                <div className="list">
                  {campaigns.map((c) => (
                    <Link href={`/report?c=${encodeURIComponent(c.name)}`} className="list-item" key={c.name}>
                      <div className="grow"><div className="t">{c.name}</div><div className="muted small">{c.posts} post{c.posts === 1 ? "" : "s"} · {fmt(c.views || c.likes)} {c.views ? "views" : "likes"}</div></div>
                      <div style={{ textAlign: "right" }}><b className={c.gain > 0 ? "up" : "muted"}>{c.gain > 0 ? `+${fmt(c.gain)}` : "0"}</b><div className="muted small">{c.gainViews ? "views" : "likes"}, {periodLabel}</div></div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-head"><span className="chip up"><Icon name="users" size={12} /></span><h2>Audience</h2><span className="grow" /><Link href="/accounts" className="muted small">Accounts →</Link></div>
              {audience === null ? <Skeleton h={120} /> : audience.rows.length === 0 ? <div className="muted">Track accounts to follow follower growth. <Link href="/accounts" className="up">Add one</Link></div> : (
                <>
                  <div className="aud-total"><b>{fmt(audience.total)}</b><span className="muted small">followers across {audience.rows.length} account{audience.rows.length === 1 ? "" : "s"}</span></div>
                  <div className="list">
                    {audience.rows.slice(0, 4).map((r) => (
                      <div className="list-item" key={r.a.id}>
                        <PlatformMark platform={r.a.platform} size={26} />
                        <div className="grow"><div className="t">@{r.a.handle}</div></div>
                        <div style={{ textAlign: "right" }}><b>{fmt(r.followers)}</b>{r.change !== null && <div className={`small ${r.change >= 0 ? "up" : "down"}`}>{delta(r.change)}</div>}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="card">
              <div className="card-head"><span className={`chip ${needsAttention.length ? "warn" : "up"}`}><Icon name={needsAttention.length ? "alert" : "check"} size={12} /></span><h2>Needs attention</h2></div>
              {needsAttention.length === 0 ? <div className="muted">Everything is being tracked normally.</div> : (
                <div className="list">
                  {needsAttention.slice(0, 4).map((p) => (
                    <Link href={`/post?id=${p.id}`} className="list-item" key={p.id}>
                      <Thumb src={p.thumbnail} platform={p.platform} size={30} />
                      <div className="grow"><div className="t">{postTitle(p)}</div><div className="small" style={{ color: "var(--warn)" }}>{p.last_error ? p.last_error.slice(0, 70) : `no new data since ${ago(p.last_taken_at)}`}</div></div>
                    </Link>
                  ))}
                  {needsAttention.length > 4 && <div className="muted small" style={{ paddingTop: 10 }}>+{needsAttention.length - 4} more on the Posts page</div>}
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

/** Cover image for a top-content card, falling back to the platform mark if the (expiring) link fails. */
function TopImg({ src, platform }: { src: string; platform: PostRow["platform"] }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <div className="top-fallback"><PlatformMark platform={platform} size={40} /></div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}
