"use client";
// Reports: open a campaign report (with PDF download) and manage read-only client links.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { PostRow, ShareLink } from "@/lib/types";
import { ago, copyText, fmt } from "@/lib/utils";
import { Empty, Icon, Skeleton, Thumb, useToast } from "@/components/ui";

const ALL = "\u0000all"; // key for "all posts" (campaign null)
const keyOf = (c: string | null) => (c === null ? ALL : c);
const reportHref = (c: string | null) => (c === null ? "/report" : `/report?c=${encodeURIComponent(c)}`);
const shareUrl = (token: string) => (typeof window === "undefined" ? "" : `${window.location.origin}/report?t=${token}`);

export default function ReportsPage() {
  const [posts, setPosts] = useState<PostRow[] | null>(null);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const { toast, show } = useToast();

  const load = useCallback(async () => {
    try {
      const [p, l] = await Promise.all([api.posts(), api.shares()]);
      setPosts(p); setLinks(l);
    } catch (e) { setPosts((x) => x ?? []); show(e instanceof Error ? e.message : "Could not load"); }
  }, [show]);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    if (!posts) return [];
    const m = new Map<string, { campaign: string | null; posts: PostRow[] }>();
    m.set(ALL, { campaign: null, posts });
    for (const p of posts) {
      if (!p.campaign) continue;
      if (!m.has(p.campaign)) m.set(p.campaign, { campaign: p.campaign, posts: [] });
      m.get(p.campaign)!.posts.push(p);
    }
    const [all, ...rest] = Array.from(m.values());
    return [all, ...rest.sort((a, b) => b.posts.length - a.posts.length || String(a.campaign).localeCompare(String(b.campaign)))];
  }, [posts]);

  async function create(c: string | null) {
    setBusy(keyOf(c));
    try {
      const l = await api.createShare(c);
      await load(); // show the link first; copying is a bonus
      show((await copyText(shareUrl(l.token))) ? "Client link created and copied to the clipboard." : "Client link created. Use Copy to copy it.");
    } catch (e) { show(e instanceof Error ? e.message : "Could not create link"); }
    setBusy(null);
  }
  async function copy(token: string) {
    show((await copyText(shareUrl(token))) ? "Link copied." : `Copy this link: ${shareUrl(token)}`);
  }
  async function revoke(l: ShareLink) {
    if (!confirm("Revoke this link? Anyone using it will no longer be able to open the report.")) return;
    try { await api.revokeShare(l.token); show("Link revoked."); await load(); } catch (e) { show(e instanceof Error ? e.message : "Could not revoke"); }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Reports</h1><div className="sub">Client-ready campaign reports. Download as PDF, or send a read-only link that always shows live numbers.</div></div>
      </div>

      {posts === null ? <div className="grid"><Skeleton h={120} /><Skeleton h={120} /></div> : posts.length === 0 ? (
        <div className="card"><Empty icon="report" title="No posts yet">Add posts (with a campaign name) to build reports.</Empty></div>
      ) : (
        <div className="grid">
          {groups.map((g) => {
            const k = keyOf(g.campaign);
            const mine = links.filter((l) => keyOf(l.campaign) === k);
            const views = g.posts.reduce((s, p) => s + (p.views ?? 0), 0);
            const likes = g.posts.reduce((s, p) => s + (p.likes ?? 0), 0);
            return (
              <div className="card" key={k}>
                <div className="report-card-head">
                  <div className="thumb-stack">
                    {g.posts.slice(0, 3).map((p) => <Thumb key={p.id} src={p.thumbnail} platform={p.platform} size={40} badge={false} />)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <h2 style={{ fontSize: 16 }}>{g.campaign ?? "All posts"}</h2>
                      {g.campaign === null && <span className="chip">every campaign</span>}
                    </div>
                    <div className="muted small">{g.posts.length} post{g.posts.length === 1 ? "" : "s"} · {fmt(views)} views · {fmt(likes)} likes</div>
                  </div>
                  <div className="row-actions" style={{ flexWrap: "wrap" }}>
                    <Link className="btn" href={reportHref(g.campaign)}><Icon name="report" size={15} /> Open report</Link>
                    <button className="btn primary" onClick={() => create(g.campaign)} disabled={busy === k}><Icon name="link" size={15} /> {busy === k ? "Creating…" : "New client link"}</button>
                  </div>
                </div>
                {mine.length > 0 && (
                  <div className="share-list">
                    {mine.map((l) => (
                      <div className="share-item" key={l.token}>
                        <Icon name="link" size={14} />
                        <code title={shareUrl(l.token)}>{shareUrl(l.token).replace(/^https?:\/\//, "")}</code>
                        <span className="muted small">by {l.created_by.split("@")[0] || "team"} · {ago(l.created_at)}</span>
                        <span className="grow" />
                        <a className="btn sm" href={`/report?t=${l.token}`} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> Preview</a>
                        <button className="btn sm" onClick={() => copy(l.token)}>Copy</button>
                        <button className="btn sm danger" onClick={() => revoke(l)}>Revoke</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div className="muted small">Client links are read-only and need no login: they show the campaign's posts and numbers only, never your settings, team or other campaigns. Revoke a link at any time.</div>
        </div>
      )}
      {toast}
    </>
  );
}
