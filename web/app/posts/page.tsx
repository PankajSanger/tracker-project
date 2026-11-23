"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { usePosts } from "@/lib/hooks";
import type { Platform, PostRow } from "@/lib/types";
import { ago, delta, download, effectiveInterval, engagement, fmt, intervalLabel, isStale, pct, postTitle, toCsv, viewsStale, PLATFORM_LABEL } from "@/lib/utils";
import { DeltaChip, Empty, Icon, PlatformMark, Seg, Skeleton, Sparkline, Thumb, Cover, useToast } from "@/components/ui";

type SortKey = "likes" | "views" | "comments" | "likes_24h" | "views_24h" | "eng" | "recent" | "added";

const SORTS: [SortKey, string][] = [
  ["likes", "Most likes"], ["views", "Most views"], ["comments", "Most comments"], ["likes_24h", "Fastest growing (likes 24h)"],
  ["views_24h", "Fastest growing (views 24h)"], ["eng", "Highest engagement"], ["recent", "Recently updated"], ["added", "Newest added"],
];

const sortValue = (p: PostRow, k: SortKey): number => {
  switch (k) {
    case "eng": return engagement(p) ?? -1;
    case "recent": return p.last_taken_at ? new Date(p.last_taken_at).getTime() : 0;
    case "added": return new Date(p.created_at).getTime();
    default: return (p[k] as number | null) ?? -1;
  }
};

export default function PostsPage() {
  const { posts, settings, error, reload } = usePosts();
  const router = useRouter();
  const { toast, show } = useToast();
  const [urls, setUrls] = useState("");
  const [campaignNew, setCampaignNew] = useState("");
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState<"all" | Platform>("all");
  const [campaign, setCampaign] = useState("all");
  const [who, setWho] = useState("all");
  const [status, setStatus] = useState<"all" | "active" | "paused" | "attention">("all");
  const [sort, setSort] = useState<SortKey>("likes");
  const [view, setView] = useState<"table" | "cards">("table");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkCampaign, setBulkCampaign] = useState("");

  const defaults = settings as unknown as Record<string, number>;
  const attention = (p: PostRow) => p.active && (!!p.last_error || isStale(p, effectiveInterval(p, defaults)));

  const campaigns = useMemo(() => Array.from(new Set((posts ?? []).map((p) => p.campaign).filter(Boolean))) as string[], [posts]);
  const people = useMemo(() => Array.from(new Set((posts ?? []).map((p) => p.added_by).filter(Boolean))) as string[], [posts]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: (posts ?? []).length, instagram: 0, youtube: 0, twitter: 0 };
    (posts ?? []).forEach((p) => { c[p.platform]++; });
    return c;
  }, [posts]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const f = (posts ?? []).filter((p) =>
      (platform === "all" || p.platform === platform) &&
      (campaign === "all" || p.campaign === campaign) &&
      (who === "all" || p.added_by === who) &&
      (status === "all" || (status === "active" ? p.active : status === "paused" ? !p.active : attention(p))) &&
      (!needle || `${p.title ?? ""} ${p.author ?? ""} ${p.campaign ?? ""} ${p.external_id} ${p.url}`.toLowerCase().includes(needle)));
    return [...f].sort((a, b) => sortValue(b, sort) - sortValue(a, sort));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, q, platform, campaign, who, status, sort, settings]);

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = shown.length > 0 && shown.every((p) => sel.has(p.id));
  const toggleAll = () => setSel(allOn ? new Set() : new Set(shown.map((p) => p.id)));

  async function addPosts() {
    try {
      const r = await api.addPosts(urls.split(/\s+/).filter(Boolean), campaignNew);
      show(`Added ${r.added} post(s)${r.skipped ? `, ${r.skipped} already tracked` : ""}${r.bad.length ? `. Not recognised: ${r.bad.join(", ")}` : ""}`);
      setUrls("");
      reload();
    } catch (e) { show(e instanceof Error ? e.message : "Could not add posts"); }
  }

  async function removePosts(ids: string[]) {
    if (!ids.length || !confirm(`Delete ${ids.length} post${ids.length > 1 ? "s" : ""} from the tracker? Their history stays in the Google Sheet.`)) return;
    try {
      for (const id of ids) await api.deletePost(id);
      show(`Deleted ${ids.length} post(s)`);
      setSel(new Set());
      reload();
    } catch (e) { show(e instanceof Error ? e.message : "Delete failed"); }
  }

  async function checkNow(ids: string[]) {
    try {
      for (const id of ids) await api.checkNow(id);
      show(`Queued ${ids.length} post(s) - fresh numbers within about 5 minutes.`);
    } catch (e) { show(e instanceof Error ? e.message : "Could not queue"); }
  }

  async function bulk(patch: { active?: boolean; campaign?: string | null }) {
    const ids = Array.from(sel);
    try {
      for (const id of ids) await api.updatePost(id, patch);
      show(`Updated ${ids.length} post(s)`);
      setSel(new Set());
      setBulkCampaign("");
      reload();
    } catch (e) { show(e instanceof Error ? e.message : "Update failed"); }
  }

  function exportCsv() {
    download("posts.csv", toCsv(shown.map((p) => ({
      platform: p.platform, url: p.url, title: p.title, author: p.author, campaign: p.campaign, added_by: p.added_by,
      likes: p.likes, comments: p.comments, views: p.views, likes_24h: p.likes_24h, comments_24h: p.comments_24h, views_24h: p.views_24h,
      engagement_pct: engagement(p)?.toFixed(2), interval: intervalLabel(effectiveInterval(p, defaults)), status: p.active ? "active" : "paused", last_updated: p.last_taken_at,
    }))));
  }

  const statusDot = (p: PostRow) => (!p.active ? <span className="dot" title="Paused" /> : p.last_error ? <span className="dot bad" title={p.last_error} /> : attention(p) ? <span className="dot warn" title="No recent data" /> : <span className="dot ok" title="Tracking normally" />);

  return (
    <>
      <div className="page-head">
        <div><h1>Posts</h1><div className="sub">{shown.length} of {(posts ?? []).length} posts{error ? <span className="err"> · {error}</span> : null}</div></div>
        <div className="grow" />
        <button className="btn" onClick={exportCsv} disabled={!shown.length}><Icon name="download" size={15} /> Export CSV</button>
        <button className="btn primary" disabled={sel.size < 2} onClick={() => router.push(`/compare?ids=${Array.from(sel).slice(0, 6).join(",")}`)}><Icon name="bars" size={15} /> Compare{sel.size >= 2 ? ` (${Math.min(sel.size, 6)})` : ""}</button>
      </div>

      <div className="card" style={{ marginBottom: 14, padding: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div className="field" style={{ flex: 1, minWidth: 260 }}>
          <span className="ico-in"><Icon name="plus" size={16} /></span>
          <input className="input search" style={{ width: "100%" }} placeholder="Paste Instagram, YouTube or X links (space or newline separated)" value={urls} onChange={(e) => setUrls(e.target.value)} onKeyDown={(e) => e.key === "Enter" && urls.trim() && addPosts()} />
        </div>
        <input className="input" style={{ width: 170 }} placeholder="Campaign (optional)" value={campaignNew} onChange={(e) => setCampaignNew(e.target.value)} />
        <button className="btn primary" onClick={addPosts} disabled={!urls.trim()}>Track</button>
      </div>

      <div className="toolbar">
        <div className="field">
          <span className="ico-in"><Icon name="search" size={15} /></span>
          <input className="input search" placeholder="Search posts…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 230 }} />
        </div>
        <div className="pills">
          {(["all", "instagram", "youtube", "twitter"] as const).map((pf) => (
            <button key={pf} className={`pill ${platform === pf ? "on" : ""}`} onClick={() => setPlatform(pf)}>
              {pf !== "all" && <PlatformMark platform={pf} size={16} />}
              {pf === "all" ? "All" : PLATFORM_LABEL[pf]} <span className="n">{counts[pf]}</span>
            </button>
          ))}
        </div>
        <span className="grow" />
        {campaigns.length > 0 && (
          <select className="select" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
            <option value="all">All campaigns</option>{campaigns.map((c) => <option key={c}>{c}</option>)}
          </select>
        )}
        {people.length > 1 && (
          <select className="select" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="all">Added by: everyone</option>{people.map((c) => <option key={c} value={c}>{c.split("@")[0]}</option>)}
          </select>
        )}
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">Any status</option><option value="active">Active</option><option value="paused">Paused</option><option value="attention">Needs attention</option>
        </select>
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <Seg value={view} onChange={setView} options={[{ value: "table", label: <Icon name="rows" size={14} /> }, { value: "cards", label: <Icon name="grid" size={14} /> }]} />
      </div>

      {posts === null ? <Skeleton h={320} /> : shown.length === 0 ? (
        <div className="card"><Empty icon="search" title={posts.length ? "No posts match these filters" : "No posts yet"}>{posts.length ? "Try clearing the search or filters." : "Paste a link above to start tracking."}</Empty></div>
      ) : view === "table" ? (
        <div className="card flush">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="c" style={{ width: 36 }}><input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Select all" /></th>
                  <th className="l">Post</th>
                  <th className={sort === "likes" ? "sorted" : ""} onClick={() => setSort("likes")}>Likes</th>
                  <th className={sort === "likes_24h" ? "sorted" : ""} onClick={() => setSort("likes_24h")}>24h</th>
                  <th className={sort === "comments" ? "sorted" : ""} onClick={() => setSort("comments")}>Comments</th>
                  <th className={sort === "views" ? "sorted" : ""} onClick={() => setSort("views")}>Views</th>
                  <th className={sort === "views_24h" ? "sorted" : ""} onClick={() => setSort("views_24h")}>24h</th>
                  <th className={sort === "eng" ? "sorted" : ""} onClick={() => setSort("eng")}>Eng.</th>
                  <th className="c">Trend</th>
                  <th className={sort === "recent" ? "sorted" : ""} onClick={() => setSort("recent")}>Updated</th>
                  <th className="c" style={{ width: 40 }} />
                  <th className="c" style={{ width: 84 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} className={p.active ? "" : "paused"}>
                    <td className="c"><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} aria-label="Select" /></td>
                    <td className="l">
                      <div className="post-cell">
                        <Thumb src={p.thumbnail} platform={p.platform} size={42} />
                        <div style={{ minWidth: 0 }}>
                          <Link href={`/post?id=${p.id}`} className="t" title={postTitle(p)}>{postTitle(p)}</Link>
                          <div className="s">
                            <span>{p.author ?? PLATFORM_LABEL[p.platform]}</span>
                            {p.campaign && <span className="tag">{p.campaign}</span>}
                            {p.added_by && <span>by {p.added_by.split("@")[0]}</span>}
                            {p.interval_min && <span className="chip"><Icon name="clock" size={10} /> {intervalLabel(p.interval_min)}</span>}
                          </div>
                          {p.last_error && <div className="err small" title={p.last_error} style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: 380 }}>{p.last_error}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{ fontWeight: 650 }}>{fmt(p.likes)}</td>
                    <td className={(p.likes_24h ?? 0) >= 0 ? "up" : "down"}>{delta(p.likes_24h)}</td>
                    <td>{fmt(p.comments)}</td>
                    <td style={{ fontWeight: 650 }} title={viewsStale(p) ? `last seen ${ago(p.views_at)}` : undefined}>{fmt(p.views)}{viewsStale(p) && <span className="faint small"> *</span>}</td>
                    <td className={(p.views_24h ?? 0) >= 0 ? "up" : "down"}>{delta(p.views_24h)}</td>
                    <td className="muted">{pct(engagement(p), 1)}</td>
                    <td className="c"><Sparkline values={p.spark} color={(p.likes_24h ?? 0) >= 0 ? "var(--good)" : "var(--bad)"} width={86} height={28} /></td>
                    <td className="muted">{ago(p.last_taken_at)}</td>
                    <td className="c">{statusDot(p)}</td>
                    <td className="c" style={{ whiteSpace: "nowrap" }}>
                      <button className="btn icon ghost sm" title="Check now" onClick={() => checkNow([p.id])}><Icon name="refresh" size={14} /></button>
                      <button className="btn icon ghost sm danger" title="Delete" onClick={() => removePosts([p.id])}><Icon name="trash" size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid thirds">
          {shown.map((p) => (
            <div key={p.id} className="card post-card" style={{ opacity: p.active ? 1 : 0.6 }} onClick={() => router.push(`/post?id=${p.id}`)}>
              {p.thumbnail && <Cover src={p.thumbnail} />}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <PlatformMark platform={p.platform} size={28} />
                <span className="muted small" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.author ?? PLATFORM_LABEL[p.platform]}</span>
                {statusDot(p)}
                <button className="btn icon ghost sm danger" title="Delete" onClick={(e) => { e.stopPropagation(); removePosts([p.id]); }}><Icon name="trash" size={13} /></button>
                <input type="checkbox" checked={sel.has(p.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(p.id)} aria-label="Select" />
              </div>
              <div className="title">{postTitle(p)}</div>
              <div className="metrics">
                <div className="m"><div className="v">{fmt(p.likes)}</div><div className="l">Likes</div></div>
                <div className="m"><div className="v">{fmt(p.comments)}</div><div className="l">Comments</div></div>
                <div className="m"><div className="v">{fmt(p.views)}</div><div className="l">Views</div></div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <DeltaChip value={p.likes_24h} suffix=" likes/24h" />
                <span style={{ flex: 1 }} />
                <Sparkline values={p.spark} color={(p.likes_24h ?? 0) >= 0 ? "var(--good)" : "var(--bad)"} width={96} height={30} />
              </div>
              {p.campaign && <div><span className="tag">{p.campaign}</span></div>}
            </div>
          ))}
        </div>
      )}

      {sel.size > 0 && (
        <div className="bulk">
          <b>{sel.size} selected</b>
          <span style={{ flex: 1 }} />
          <input className="input" style={{ width: 150, background: "rgba(255,255,255,.1)", borderColor: "rgba(255,255,255,.25)", color: "inherit" }} placeholder="Set campaign…" value={bulkCampaign} onChange={(e) => setBulkCampaign(e.target.value)} />
          <button className="btn sm" disabled={!bulkCampaign.trim()} onClick={() => bulk({ campaign: bulkCampaign })}>Apply</button>
          <button className="btn sm" onClick={() => bulk({ active: false })}><Icon name="pause" size={13} /> Pause</button>
          <button className="btn sm" onClick={() => bulk({ active: true })}><Icon name="play" size={13} /> Resume</button>
          <button className="btn sm" onClick={() => checkNow(Array.from(sel))}><Icon name="refresh" size={13} /> Check now</button>
          <button className="btn sm" onClick={() => removePosts(Array.from(sel))}><Icon name="trash" size={13} /> Delete</button>
          <button className="btn sm" onClick={() => setSel(new Set())}><Icon name="x" size={13} /></button>
        </div>
      )}
      {toast}
    </>
  );
}
