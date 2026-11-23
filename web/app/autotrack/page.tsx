"use client";
// Auto-track: watch accounts and add every new post they publish to tracking automatically.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Platform, PostRow, Watch } from "@/lib/types";
import { ago, fmt, postTitle, PLATFORM_LABEL } from "@/lib/utils";
import { Empty, Icon, PlatformMark, Seg, Skeleton, Thumb, useToast } from "@/components/ui";

const EVERY = [
  { value: 60, label: "Every hour" },
  { value: 180, label: "Every 3 hours" },
  { value: 360, label: "Every 6 hours" },
  { value: 720, label: "Every 12 hours" },
  { value: 1440, label: "Once a day" },
];
const BACKFILL = [
  { value: 0, label: "Only new posts from now on" },
  { value: 3, label: "Also posts from the last 3 days" },
  { value: 7, label: "Also posts from the last 7 days" },
  { value: 30, label: "Also posts from the last 30 days" },
];
const COST: Record<Platform, string> = {
  instagram: "1 Apify result per check (cheap)",
  youtube: "up to 10 Apify results per check (5 videos + 5 Shorts)",
  twitter: "up to 5 Apify results per check · needs a paid Apify plan",
};
const everyLabel = (m: number | null) => EVERY.find((e) => e.value === (m ?? 180))?.label ?? `Every ${m} min`;
const profileUrl = (w: Watch) => (w.platform === "instagram" ? `https://www.instagram.com/${w.handle}/` : w.platform === "youtube" ? `https://www.youtube.com/@${w.handle}` : `https://x.com/${w.handle}`);

export default function AutoTrackPage() {
  const [watches, setWatches] = useState<Watch[] | null>(null);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [handle, setHandle] = useState("");
  const [campaign, setCampaign] = useState("");
  const [every, setEvery] = useState(180);
  const [backfill, setBackfill] = useState(0);
  const [busy, setBusy] = useState(false);
  const { toast, show } = useToast();

  const load = useCallback(async () => {
    try {
      const [w, p] = await Promise.all([api.watches(), api.posts()]);
      setWatches(w); setPosts(p);
    } catch (e) { setWatches((x) => x ?? []); show(e instanceof Error ? e.message : "Could not load"); }
  }, [show]);
  useEffect(() => { load(); }, [load]);

  const campaigns = useMemo(() => Array.from(new Set(posts.map((p) => p.campaign).filter(Boolean))) as string[], [posts]);
  const autoPosts = useMemo(() => posts.filter((p) => (p.added_by ?? "").startsWith("auto:")).sort((a, b) => b.created_at.localeCompare(a.created_at)), [posts]);
  const postsOf = (w: Watch) => autoPosts.filter((p) => p.platform === w.platform && (p.added_by ?? "").toLowerCase() === `auto:@${w.handle.toLowerCase()}`);

  async function add() {
    if (!handle.trim()) return;
    setBusy(true);
    try {
      await api.addWatch({ platform, handle, campaign: campaign.trim() || null, interval_min: every, backfill_days: backfill });
      setHandle("");
      show("Account added. It is checked on the next run (within ~15 minutes); new posts then appear in Posts automatically.");
      await load();
    } catch (e) { show(e instanceof Error ? e.message : "Could not add"); }
    setBusy(false);
  }
  async function patch(w: Watch, p: { active?: boolean; interval_min?: number; campaign?: string | null }, msg: string) {
    try { await api.updateWatch(w.id, p); show(msg); await load(); } catch (e) { show(e instanceof Error ? e.message : "Update failed"); }
  }
  async function remove(w: Watch) {
    if (!confirm(`Stop auto-tracking @${w.handle}? Posts already added stay tracked.`)) return;
    try { await api.deleteWatch(w.id); show("Auto-track removed."); await load(); } catch (e) { show(e instanceof Error ? e.message : "Could not remove"); }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Auto-track</h1><div className="sub">Watch an account and every new post it publishes is added and tracked automatically. No more pasting links.</div></div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><Icon name="plus" /><h2>Watch an account</h2></div>
        <div className="watch-form">
          <Seg value={platform} onChange={setPlatform} options={[{ value: "instagram", label: "Instagram" }, { value: "youtube", label: "YouTube" }, { value: "twitter", label: "X" }]} />
          <input className="input" style={{ flex: 2, minWidth: 200 }} placeholder={platform === "youtube" ? "@channel or channel link" : "@handle or profile link"} value={handle}
            onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <input className="input" style={{ flex: 1, minWidth: 150 }} placeholder="Campaign (optional)" list="campaign-list" value={campaign} onChange={(e) => setCampaign(e.target.value)} />
          <datalist id="campaign-list">{campaigns.map((c) => <option key={c} value={c} />)}</datalist>
          <select className="select" value={every} onChange={(e) => setEvery(Number(e.target.value))} aria-label="How often to look for new posts">
            {EVERY.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
          <select className="select" value={backfill} onChange={(e) => setBackfill(Number(e.target.value))} aria-label="Which posts to add">
            {BACKFILL.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
          <button className="btn primary" onClick={add} disabled={!handle.trim() || busy}><Icon name="zap" size={15} /> {busy ? "Adding…" : "Start auto-tracking"}</button>
        </div>
        <div className="muted small" style={{ marginTop: 10 }}>Cost: {COST[platform]}. Each new post is then tracked like any other post (its own interval from Settings).</div>
      </div>

      {watches === null ? <div className="grid"><Skeleton h={110} /><Skeleton h={110} /></div> : watches.length === 0 ? (
        <div className="card"><Empty icon="zap" title="No accounts auto-tracked yet">Add an account above. Its new posts will show up in Posts and in reports automatically.</Empty></div>
      ) : (
        <div className="grid">
          {watches.map((w) => {
            const mine = postsOf(w);
            return (
              <div className="card" key={w.id} style={{ opacity: w.active ? 1 : 0.65 }}>
                <div className="watch-head">
                  <PlatformMark platform={w.platform} size={38} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <a href={profileUrl(w)} target="_blank" rel="noreferrer" style={{ fontWeight: 650, fontSize: 15 }}>@{w.handle}</a>
                      <span className={`chip ${!w.active ? "" : w.last_error ? "warn" : "up"}`}>
                        <span className={`dot ${!w.active ? "" : w.last_error ? "warn" : "ok"}`} /> {!w.active ? "Paused" : w.last_error ? "Problem" : w.last_checked ? "Watching" : "Waiting for first check"}
                      </span>
                      {w.campaign && <span className="tag">{w.campaign}</span>}
                    </div>
                    <div className="muted small">
                      {PLATFORM_LABEL[w.platform]} · {everyLabel(w.interval_min)} · checked {ago(w.last_checked)} · {w.posts_found} post{w.posts_found === 1 ? "" : "s"} added{w.last_found ? `, latest ${ago(w.last_found)}` : ""}
                    </div>
                    {w.last_error && <div className="small" style={{ color: "var(--warn)", marginTop: 2 }}><Icon name="alert" size={12} /> {w.last_error}</div>}
                  </div>
                  <div className="row-actions" style={{ flexWrap: "wrap" }}>
                    <select className="select" value={w.interval_min ?? 180} onChange={(e) => patch(w, { interval_min: Number(e.target.value) }, "Check frequency updated.")} aria-label="Check frequency">
                      {EVERY.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
                    </select>
                    <button className="btn" onClick={() => patch(w, { active: !w.active }, w.active ? "Paused." : "Resumed.")}><Icon name={w.active ? "pause" : "play"} size={14} /> {w.active ? "Pause" : "Resume"}</button>
                    <button className="btn icon danger" title="Stop auto-tracking" onClick={() => remove(w)}><Icon name="trash" size={15} /></button>
                  </div>
                </div>
                {mine.length > 0 && (
                  <div className="watch-posts">
                    {mine.slice(0, 6).map((p) => (
                      <Link href={`/post?id=${p.id}`} className="watch-post" key={p.id} title={postTitle(p)}>
                        <Thumb src={p.thumbnail} platform={p.platform} size={44} badge={false} />
                        <div style={{ minWidth: 0 }}>
                          <div className="t">{postTitle(p)}</div>
                          <div className="muted small">added {ago(p.created_at)} · {fmt(p.views ?? p.likes)} {p.views !== null ? "views" : "likes"}</div>
                        </div>
                      </Link>
                    ))}
                    {mine.length > 6 && <Link href="/posts" className="muted small" style={{ alignSelf: "center" }}>+{mine.length - 6} more in Posts →</Link>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="muted small" style={{ marginTop: 14 }}>
        How it works: on each run the tracker looks at the account&apos;s newest posts (Instagram: latest 12, YouTube: latest 5 videos + 5 Shorts, X: latest 5) and adds any it is not tracking yet,
        published after the start date you chose. Pinned old posts are ignored. Removing an account here never deletes posts that were already added.
      </div>
      {toast}
    </>
  );
}
