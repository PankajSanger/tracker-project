"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import type { PostRow, Snapshot } from "@/lib/types";
import { engagement, fmt, pct, postTitle, PLATFORM_LABEL } from "@/lib/utils";
import { Empty, Icon, PlatformMark, Seg, Skeleton } from "@/components/ui";
import { AXIS, GRID, TipCard } from "@/components/charts";

type Metric = "likes" | "comments" | "views";
const PALETTE = ["#1f5fd6", "#d6336c", "#0f9488", "#d98a06", "#7048e8", "#0891b2"];
const RANGES: Record<string, number> = { "24h": 864e5, "7d": 7 * 864e5, "30d": 30 * 864e5, all: 0 };

function Compare() {
  const router = useRouter();
  const params = useSearchParams();
  const ids = useMemo(() => (params.get("ids") ?? "").split(",").filter(Boolean).slice(0, 6), [params]);
  const [posts, setPosts] = useState<PostRow[] | null>(null);
  const [series, setSeries] = useState<Record<string, Snapshot[]>>({});
  const [metric, setMetric] = useState<Metric>("likes");
  const [index, setIndex] = useState(true);
  const [range, setRange] = useState<keyof typeof RANGES>("7d");
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.posts().then(setPosts).catch(() => setPosts([])); }, []);
  useEffect(() => {
    if (!ids.length) { setSeries({}); return; }
    setLoading(true);
    api.compare(ids).then((r) => setSeries(r.series)).catch(() => setSeries({})).finally(() => setLoading(false));
  }, [ids]);

  const chosen = ids.map((id) => posts?.find((p) => p.id === id)).filter(Boolean) as PostRow[];
  const setIds = (next: string[]) => router.replace(next.length ? `/compare?ids=${next.join(",")}` : "/compare");

  // Merge all posts onto one time axis (each post's last known value, carried forward).
  const { data, base } = useMemo(() => {
    const lo = RANGES[range] ? Date.now() - RANGES[range] : 0;
    const times = new Set<number>();
    const per: Record<string, { t: number; v: number | null }[]> = {};
    ids.forEach((id) => {
      per[id] = (series[id] ?? []).map((s) => ({ t: new Date(s.taken_at).getTime(), v: s[metric] })).filter((p) => p.t >= lo);
      per[id].forEach((p) => times.add(p.t));
    });
    const sorted = Array.from(times).sort((a, b) => a - b);
    const step = Math.max(1, Math.ceil(sorted.length / 120));
    const ts = sorted.filter((_, i) => i % step === 0 || i === sorted.length - 1);
    const basis: Record<string, number> = {};
    ids.forEach((id) => { const first = per[id].find((p) => p.v !== null); if (first && first.v) basis[id] = first.v; });
    const rows = ts.map((t) => {
      const row: Record<string, number | null> = { t };
      ids.forEach((id) => {
        const upto = per[id].filter((p) => p.t <= t && p.v !== null);
        const cur = upto.length ? (upto[upto.length - 1].v as number) : null;
        row[id] = cur === null ? null : index && basis[id] ? (cur / basis[id]) * 100 : cur;
      });
      return row;
    });
    return { data: rows, base: basis };
  }, [series, ids, metric, index, range]);

  const available = (posts ?? []).filter((p) => !ids.includes(p.id));

  return (
    <>
      <div className="page-head">
        <div><h1>Compare</h1><div className="sub">Overlay up to 6 posts to see which one is pulling ahead.</div></div>
        <div className="grow" />
        {ids.length > 0 && <button className="btn" onClick={() => setIds([])}>Clear</button>}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="toolbar" style={{ marginBottom: chosen.length ? 12 : 0 }}>
          <select className="select" style={{ minWidth: 280, maxWidth: "100%" }} value="" disabled={ids.length >= 6 || !available.length}
            onChange={(e) => e.target.value && setIds([...ids, e.target.value])}>
            <option value="">{ids.length >= 6 ? "Maximum of 6 posts" : "+ Add a post to compare…"}</option>
            {available.map((p) => <option key={p.id} value={p.id}>{PLATFORM_LABEL[p.platform]} · {postTitle(p).slice(0, 70)}</option>)}
          </select>
          <span className="grow" />
          <Seg value={metric} onChange={setMetric} options={[{ value: "likes", label: "Likes" }, { value: "comments", label: "Comments" }, { value: "views", label: "Views" }]} />
          <Seg value={range} onChange={setRange} options={Object.keys(RANGES).map((k) => ({ value: k, label: k === "all" ? "All" : k }))} />
          <Seg value={index ? "idx" : "abs"} onChange={(v) => setIndex(v === "idx")} options={[{ value: "idx", label: "Growth (index 100)" }, { value: "abs", label: "Absolute" }]} />
        </div>
        <div className="legend" style={{ marginTop: 0 }}>
          {chosen.map((p, i) => (
            <span key={p.id} className="chip" style={{ padding: "4px 10px" }}>
              <i style={{ background: PALETTE[i % PALETTE.length] }} />
              <PlatformMark platform={p.platform} size={16} />
              <span style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{postTitle(p)}</span>
              <button className="btn icon ghost" style={{ padding: 2, border: 0 }} onClick={() => setIds(ids.filter((x) => x !== p.id))} aria-label="Remove"><Icon name="x" size={12} /></button>
            </span>
          ))}
        </div>
      </div>

      {posts === null ? <Skeleton h={360} /> : ids.length < 2 ? (
        <div className="card"><Empty icon="bars" title="Pick at least two posts">Use the menu above, or select posts on the <Link href="/posts" className="up">Posts page</Link> and press Compare.</Empty></div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-head"><h2>{index ? `${metric} growth, indexed to 100 at the start of the range` : metric}</h2></div>
            <div className="chart-box">
              {loading ? <Skeleton h={320} /> : data.length < 2 ? <Empty icon="clock" title="Not enough data in this range">Try a longer range.</Empty> : (
                <ResponsiveContainer>
                  <LineChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
                    <CartesianGrid {...GRID} vertical={false} />
                    <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tick={AXIS} axisLine={false} tickLine={false} minTickGap={50}
                      tickFormatter={(t) => new Date(t).toLocaleString(undefined, range === "24h" ? { hour: "numeric" } : { month: "short", day: "numeric" })} />
                    <YAxis tick={AXIS} axisLine={false} tickLine={false} width={50} domain={["auto", "auto"]} tickFormatter={(v) => (index ? `${Math.round(v)}` : fmt(v))} />
                    <Tooltip content={({ active, payload }) => active && payload?.length ? (
                      <TipCard title={new Date(payload[0].payload.t).toLocaleString()}
                        rows={payload.filter((p) => p.value !== null).map((p) => {
                          const i = ids.indexOf(String(p.dataKey));
                          return { label: postTitle(chosen[i] ?? ({ title: null, author: null, external_id: "?" } as PostRow)).slice(0, 28), value: index ? `${Number(p.value).toFixed(1)}` : Number(p.value).toLocaleString(), color: PALETTE[i % PALETTE.length] };
                        })} />
                    ) : null} />
                    {ids.map((id, i) => <Line key={id} type="monotone" dataKey={id} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2.4} dot={false} connectNulls isAnimationActive={false} />)}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="card flush">
            <div className="table-wrap">
              <table>
                <thead><tr><th className="l">Post</th><th>Likes</th><th>Comments</th><th>Views</th><th>Engagement</th><th>Range growth</th></tr></thead>
                <tbody>
                  {chosen.map((p, i) => {
                    const g = base[p.id] && data.length ? (data[data.length - 1][p.id] as number | null) : null;
                    const growth = index ? (g === null ? null : g - 100) : base[p.id] && g ? ((g - base[p.id]) / base[p.id]) * 100 : null;
                    return (
                      <tr key={p.id}>
                        <td className="l"><div className="post-cell"><i style={{ width: 10, height: 10, borderRadius: 3, background: PALETTE[i % PALETTE.length], flex: "none" }} /><Link href={`/post?id=${p.id}`} className="t">{postTitle(p)}</Link></div></td>
                        <td>{fmt(p.likes)}</td><td>{fmt(p.comments)}</td><td>{fmt(p.views)}</td><td>{pct(engagement(p), 1)}</td>
                        <td className={(growth ?? 0) >= 0 ? "up" : "down"} style={{ fontWeight: 650 }}>{growth === null ? "-" : `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default function Page() {
  return <Suspense fallback={<Skeleton h={300} />}><Compare /></Suspense>;
}
