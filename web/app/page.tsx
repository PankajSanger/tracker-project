"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { PostRow } from "@/lib/types";
import { PLATFORM_SHORT, fmt, delta, ago, toCsv, download } from "@/lib/utils";

type SortKey = "likes" | "comments" | "views" | "likes_24h" | "views_24h" | "created_at";

export default function Dashboard() {
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [urls, setUrls] = useState("");
  const [campaignNew, setCampaignNew] = useState("");
  const [msg, setMsg] = useState("");
  const [platform, setPlatform] = useState("all");
  const [campaign, setCampaign] = useState("all");
  const [who, setWho] = useState("all");
  const [sort, setSort] = useState<SortKey>("likes");

  const load = useCallback(async () => {
    try {
      setPosts(await api.posts());
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not load posts");
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function addPosts() {
    try {
      const r = await api.addPosts(urls.split(/\s+/).filter(Boolean), campaignNew);
      setMsg(`Added ${r.added} post(s)` + (r.skipped ? `, ${r.skipped} already tracked` : "") + "." + (r.bad.length ? ` Unrecognised: ${r.bad.join(", ")}.` : "") + " First numbers appear after the next scrape run.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not add posts");
      return;
    }
    setUrls("");
    load();
  }

  const campaigns = useMemo(() => Array.from(new Set(posts.map((p) => p.campaign).filter(Boolean))) as string[], [posts]);

  const people = useMemo(() => Array.from(new Set(posts.map((p) => p.added_by).filter(Boolean))) as string[], [posts]);

  const shown = useMemo(() => {
    const f = posts.filter((p) => (platform === "all" || p.platform === platform) && (campaign === "all" || p.campaign === campaign) && (who === "all" || p.added_by === who));
    return [...f].sort((a, b) => {
      if (sort === "created_at") return b.created_at.localeCompare(a.created_at);
      return (b[sort] ?? -1) - (a[sort] ?? -1);
    });
  }, [posts, platform, campaign, who, sort]);

  const sum = (k: "likes" | "comments" | "views") => shown.reduce((t, p) => t + (p[k] ?? 0), 0);
  const sum24 = (k: "likes_24h" | "views_24h") => shown.reduce((t, p) => t + (p[k] ?? 0), 0);

  const th = (k: SortKey, label: string) => (
    <th onClick={() => setSort(k)} style={{ color: sort === k ? "var(--accent)" : undefined }}>{label}{sort === k ? " v" : ""}</th>
  );

  return (
    <>
      <div className="card">
        <div className="row grow">
          <input placeholder="Paste Instagram / X / YouTube URLs (space or newline separated)" value={urls} onChange={(e) => setUrls(e.target.value)} />
          <input style={{ flex: "0 0 160px", minWidth: 0 }} placeholder="Campaign (optional)" value={campaignNew} onChange={(e) => setCampaignNew(e.target.value)} />
          <button className="primary" onClick={addPosts} disabled={!urls.trim()}>Track</button>
        </div>
        {msg && <p className="muted" style={{ margin: "8px 0 0" }}>{msg}</p>}
      </div>

      <div className="grid">
        <div className="card kpi"><div className="l">Posts tracked</div><div className="v">{shown.length}</div></div>
        <div className="card kpi"><div className="l">Total likes</div><div className="v">{fmt(sum("likes"))}</div><span className={sum24("likes_24h") >= 0 ? "up" : "down"}>{delta(sum24("likes_24h"))} / 24h</span></div>
        <div className="card kpi"><div className="l">Total comments</div><div className="v">{fmt(sum("comments"))}</div></div>
        <div className="card kpi"><div className="l">Total views</div><div className="v">{fmt(sum("views"))}</div><span className={sum24("views_24h") >= 0 ? "up" : "down"}>{delta(sum24("views_24h"))} / 24h</span></div>
      </div>

      <div className="row" style={{ marginBottom: 10 }}>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="all">All platforms</option><option value="instagram">Instagram</option><option value="twitter">X / Twitter</option><option value="youtube">YouTube</option>
        </select>
        <select value={campaign} onChange={(e) => setCampaign(e.target.value)}>
          <option value="all">All campaigns</option>
          {campaigns.map((c) => <option key={c}>{c}</option>)}
        </select>
        {people.length > 1 && (
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="all">Added by: everyone</option>
            {people.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <span style={{ flex: 1 }} />
        <button onClick={() => download("posts.csv", toCsv(shown.map((p) => ({
          platform: p.platform, url: p.url, author: p.author, added_by: p.added_by, campaign: p.campaign, likes: p.likes, comments: p.comments,
          views: p.views, likes_24h: p.likes_24h, views_24h: p.views_24h, last_updated: p.last_taken_at }))))}>Export CSV</button>
      </div>

      <div className="card scroll" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr><th className="l">Post</th><th className="l">Campaign</th><th className="l">Added by</th>{th("likes", "Likes")}{th("likes_24h", "24h")}{th("comments", "Comments")}{th("views", "Views")}{th("views_24h", "24h")}<th>Updated</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="muted">Loading...</td></tr>}
            {!loading && !shown.length && <tr><td colSpan={8} className="muted">No posts yet. Paste a URL above.</td></tr>}
            {shown.map((p) => (
              <tr key={p.id} style={{ opacity: p.active ? 1 : 0.5 }}>
                <td className="l">
                  <span className={`badge ${p.platform}`}>{PLATFORM_SHORT[p.platform]}</span>{" "}
                  <Link href={`/post?id=${p.id}`}><span className="title">{p.title || p.author || p.external_id}</span></Link>
                  {p.last_error && <div className="err" title={p.last_error}>error: {p.last_error.slice(0, 50)}</div>}
                </td>
                <td className="l">{p.campaign ? <span className="tag">{p.campaign}</span> : ""}</td>
                <td className="l muted">{p.added_by?.split("@")[0] ?? ""}</td>
                <td>{fmt(p.likes)}</td>
                <td className={(p.likes_24h ?? 0) >= 0 ? "up" : "down"}>{delta(p.likes_24h)}</td>
                <td>{fmt(p.comments)}</td>
                <td>{fmt(p.views)}</td>
                <td className={(p.views_24h ?? 0) >= 0 ? "up" : "down"}>{delta(p.views_24h)}</td>
                <td className="muted">{ago(p.last_taken_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
