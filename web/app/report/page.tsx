"use client";
// Client-ready campaign report. Opened by the team (/report?c=Campaign, no c = all posts) or by a client through a
// read-only share link (/report?t=token). "Download PDF" prints the page with an A4 print layout.
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, fetchReport } from "@/lib/api";
import type { Platform, Report } from "@/lib/types";
import { copyText, fmt, PLATFORM_LABEL } from "@/lib/utils";
import { Empty, Icon, Seg, Skeleton, Thumb } from "@/components/ui";
import { AXIS, GRID, TipCard } from "@/components/charts";

const PERIODS = [{ value: 7, label: "7 days" }, { value: 30, label: "30 days" }, { value: 90, label: "90 days" }, { value: 0, label: "All time" }];
const PRINT_W = 680; // chart width on an A4 page
const dfmt = (d: Date | string | number, year = true) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });
const eng = (likes: number, comments: number, views: number) => (views > 0 ? ((likes + comments) / views) * 100 : null);
const plus = (n: number) => (n > 0 ? `+${fmt(n)}` : "0");

function ReportView() {
  const q = useSearchParams();
  const token = q.get("t");
  const campaign = q.get("c");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Report | null>(null);
  const [err, setErr] = useState<{ msg: string; status?: number } | null>(null);
  const [printing, setPrinting] = useState(false);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    setData(null); setErr(null);
    fetchReport({ token, campaign, days }).then(setData).catch((e) => setErr({ msg: e.message, status: e.status }));
  }, [token, campaign, days]);

  const name = data ? (data.campaign ?? "All campaigns") : "";
  useEffect(() => { if (data) document.title = `${name} - performance report - ${dfmt(new Date())}`; }, [data, name]);

  // Charts get a fixed width while printing so they fit the page (also for Ctrl+P).
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, []);
  const downloadPdf = () => { flushSync(() => setPrinting(true)); setTimeout(() => window.print(), 250); };

  const shareLink = useCallback(async () => {
    try {
      const link = await api.createShare(campaign);
      const url = `${window.location.origin}/report?t=${link.token}`;
      setCopied(url);
      copyText(url);
    } catch (e) { setCopied(e instanceof Error ? `Could not create link: ${e.message}` : "Could not create link"); }
  }, [campaign]);

  const platforms = useMemo(() => {
    if (!data) return [];
    const m = new Map<Platform, { posts: number; views: number; likes: number; comments: number }>();
    for (const p of data.posts) {
      const r = m.get(p.platform) ?? { posts: 0, views: 0, likes: 0, comments: 0 };
      r.posts++; r.views += p.views ?? 0; r.likes += p.likes ?? 0; r.comments += p.comments ?? 0;
      m.set(p.platform, r);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].views + b[1].likes - (a[1].views + a[1].likes));
  }, [data]);

  if (err)
    return (
      <div className="report-shell">
        <div className="card" style={{ maxWidth: 520, margin: "80px auto" }}>
          <Empty icon="alert" title={err.status === 401 ? "Please sign in to view reports" : "Report not available"}>
            {err.status === 401 ? <Link href="/" className="up">Go to sign in</Link> : err.msg}
          </Empty>
        </div>
      </div>
    );

  const t = data?.totals;
  const g = data?.overview.growth;
  const hasViews = !!t && t.views > 0;
  const periodText = data
    ? data.days > 0
      ? `Last ${data.days} days · ${dfmt(Date.now() - data.days * 864e5)} – ${dfmt(Date.now())}`
      : `All time${data.first_at ? ` · since ${dfmt(data.first_at)}` : ""}`
    : "";
  const series = data?.overview.series.map((p) => ({ t: p.t, views: p.g_views, likes: p.g_likes, comments: p.g_comments })) ?? [];
  const short = data ? data.days > 0 && data.days <= 7 : false;
  const xFmt = (v: number) => new Date(v).toLocaleDateString(undefined, short ? { weekday: "short", day: "numeric" } : { day: "numeric", month: "short" });

  const chart = (
    <LineChart data={series} margin={{ left: 0, right: 8, top: 8 }} {...(printing ? { width: PRINT_W, height: 230 } : {})}>
      <CartesianGrid {...GRID} vertical={false} />
      <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tick={AXIS} axisLine={false} tickLine={false} minTickGap={40} tickFormatter={xFmt} />
      <YAxis yAxisId="l" tick={AXIS} axisLine={false} tickLine={false} width={52} tickFormatter={fmt} />
      {hasViews && <YAxis yAxisId="r" orientation="right" tick={AXIS} axisLine={false} tickLine={false} width={56} tickFormatter={fmt} />}
      {!printing && <Tooltip content={({ active, payload }) => active && payload?.length ? (
        <TipCard title={new Date(payload[0].payload.t).toLocaleString()} rows={payload.map((p) => ({ label: `+${p.dataKey}`, value: Number(p.value).toLocaleString(), color: String(p.color) }))} />
      ) : null} />}
      {hasViews && <Line yAxisId="r" type="monotone" dataKey="views" stroke="var(--views)" strokeWidth={2.4} dot={false} isAnimationActive={false} />}
      <Line yAxisId="l" type="monotone" dataKey="likes" stroke="var(--likes)" strokeWidth={2.4} dot={false} isAnimationActive={false} />
      <Line yAxisId="l" type="monotone" dataKey="comments" stroke="var(--comments)" strokeWidth={2} dot={false} isAnimationActive={false} />
    </LineChart>
  );

  return (
    <div className="report-shell">
      <div className="report">
        <header className="report-head">
          <div className="brand" style={{ padding: 0 }}>
            <span className="logo"><Icon name="trend" size={19} /></span>
            <span>Social Tracker<small>Performance report</small></span>
          </div>
          <div className="report-title">
            <div className="crumb">{data?.campaign ? "Campaign" : "Portfolio"}</div>
            <h1>{data ? name : <Skeleton h={30} w={260} />}</h1>
            <div className="report-sub">{periodText}</div>
          </div>
          <div className="report-meta">
            {data && <>Generated {dfmt(data.generated_at)}<br />{data.totals.posts} post{data.totals.posts === 1 ? "" : "s"} tracked</>}
          </div>
        </header>

        <div className="report-tools no-print">
          <Seg value={days} onChange={setDays} options={PERIODS} />
          <span className="grow" />
          {data && !data.shared && <button className="btn" onClick={shareLink}><Icon name="link" size={15} /> Client link</button>}
          <button className="btn primary" onClick={downloadPdf} disabled={!data}><Icon name="download" size={15} /> Download PDF</button>
          {data && !data.shared && <Link className="btn ghost" href="/reports">Back to app</Link>}
        </div>
        {copied && <div className="banner no-print" style={{ background: "var(--accent-soft)", color: "var(--accent)", borderColor: "transparent" }}>
          <Icon name="check" size={15} /> {copied.startsWith("http") ? <>Client link ready (also listed under Reports). Anyone with it can view this report, read-only: <code style={{ wordBreak: "break-all" }}>{copied}</code></> : copied}
        </div>}

        {!data ? (
          <div className="grid"><div className="grid kpis">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={104} />)}</div><Skeleton h={300} /></div>
        ) : data.posts.length === 0 ? (
          <div className="card"><Empty icon="layers" title="No posts in this report yet">Posts appear here once they are added to this campaign.</Empty></div>
        ) : (
          <>
            <section className="grid kpis report-kpis">
              {hasViews && <ReportKpi label="Views" color="var(--views)" value={fmt(t!.views)} growth={plus(g!.views)} />}
              <ReportKpi label="Likes" color="var(--likes)" value={fmt(t!.likes)} growth={plus(g!.likes)} />
              <ReportKpi label="Comments" color="var(--comments)" value={fmt(t!.comments)} growth={plus(g!.comments)} />
              <ReportKpi label="Engagement rate" color="var(--eng)" value={hasViews ? `${eng(t!.likes, t!.comments, t!.views)!.toFixed(2)}%` : "-"} growth="likes + comments per view" plain />
              <ReportKpi label="Posts" color="var(--accent)" value={String(t!.posts)} growth={`${platforms.length} platform${platforms.length === 1 ? "" : "s"}`} plain />
            </section>

            <section className="report-row">
              <div className="card report-chart">
                <div className="card-head"><h2>Growth in this period</h2><span className="grow" />
                  <div className="legend" style={{ marginTop: 0 }}>
                    {hasViews && <span><i style={{ background: "var(--views)" }} />Views</span>}
                    <span><i style={{ background: "var(--likes)" }} />Likes</span>
                    <span><i style={{ background: "var(--comments)" }} />Comments</span>
                  </div>
                </div>
                <div style={{ height: 230 }}>{printing ? chart : <ResponsiveContainer>{chart}</ResponsiveContainer>}</div>
              </div>
              <div className="card">
                <div className="card-head"><h2>By platform</h2></div>
                <div className="list">
                  {platforms.map(([pf, r]) => {
                    const total = platforms.reduce((s, [, x]) => s + x.likes + x.comments, 0) || 1;
                    return (
                      <div className="list-item" key={pf} style={{ display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <Thumb src={null} platform={pf} size={26} />
                          <div className="grow"><div className="t">{PLATFORM_LABEL[pf]}</div><div className="muted small">{r.posts} post{r.posts === 1 ? "" : "s"}</div></div>
                          <div style={{ textAlign: "right" }}><b>{fmt(r.views || r.likes)}</b><div className="muted small">{r.views ? "views" : "likes"}</div></div>
                        </div>
                        <div className="bar"><i style={{ width: `${((r.likes + r.comments) / total) * 100}%`, background: `var(--${pf === "instagram" ? "ig" : pf === "youtube" ? "yt" : "x"})` }} /></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="card flush report-table">
              <div className="card-head" style={{ padding: "16px 20px 0" }}><h2>Content performance</h2><span className="grow" /><span className="muted small">sorted by views</span></div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="l" style={{ cursor: "default" }}>#</th>
                      <th className="l" style={{ cursor: "default" }}>Post</th>
                      <th style={{ cursor: "default" }}>Views</th>
                      <th style={{ cursor: "default" }}>Likes</th>
                      <th style={{ cursor: "default" }}>Comments</th>
                      <th style={{ cursor: "default" }}>Eng.</th>
                      <th style={{ cursor: "default" }}>{data.days ? `+${data.days}d` : "Growth"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.posts.map((p, i) => {
                      const e = p.views ? eng(p.likes ?? 0, p.comments ?? 0, p.views) : null;
                      return (
                        <tr key={p.id}>
                          <td className="l muted">{i + 1}</td>
                          <td className="l">
                            <div className="post-cell" style={{ minWidth: 220 }}>
                              <Thumb src={p.thumbnail} platform={p.platform} size={40} />
                              <div style={{ minWidth: 0 }}>
                                <a href={p.url} target="_blank" rel="noreferrer" className="t" title={p.title ?? p.url}>{p.title ?? `${PLATFORM_LABEL[p.platform]} post`}</a>
                                <div className="s"><span>{p.author ? (p.platform === "youtube" ? p.author : `@${p.author.replace(/^@/, "")}`) : PLATFORM_LABEL[p.platform]}</span>{!data.campaign && p.campaign && <span className="tag">{p.campaign}</span>}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ fontWeight: 650 }}>{fmt(p.views)}</td>
                          <td>{fmt(p.likes)}</td>
                          <td>{fmt(p.comments)}</td>
                          <td className="muted">{e === null ? "-" : `${e.toFixed(1)}%`}</td>
                          <td className="up">{p.views !== null ? plus(p.g_views) : plus(p.g_likes)}<span className="faint small"> {p.views !== null ? "views" : "likes"}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        <footer className="report-foot">
          <span>Social Tracker · Instagram, YouTube and X performance analytics</span>
          <span>{data ? `Numbers as of ${new Date(data.generated_at).toLocaleString()}` : ""}</span>
        </footer>
      </div>
    </div>
  );
}

function ReportKpi({ label, value, growth, color, plain }: { label: string; value: string; growth: string; color: string; plain?: boolean }) {
  return (
    <div className="card kpi" style={{ ["--kpi-color" as string]: color }}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="foot">{plain ? <span>{growth}</span> : <><span className="chip up">{growth}</span><span>in this period</span></>}</div>
    </div>
  );
}

export default function ReportPage() {
  return <Suspense fallback={null}><ReportView /></Suspense>;
}
