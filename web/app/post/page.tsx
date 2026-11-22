"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import type { PostRow, Snapshot } from "@/lib/types";
import { fmt, delta, toCsv, download, PLATFORM_LABEL } from "@/lib/utils";

function PostDetail() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  const [post, setPost] = useState<PostRow | null>(null);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [range, setRange] = useState(7);
  const [campaign, setCampaign] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.post(id).then(({ post, snapshots }) => {
      setPost(post);
      setCampaign(post.campaign ?? "");
      setSnaps([...snapshots].sort((a, b) => a.taken_at.localeCompare(b.taken_at)));
    }).catch(() => setFailed(true));
  }, [id]);

  const data = useMemo(() => {
    const cutoff = range ? Date.now() - range * 864e5 : 0;
    return snaps.filter((s) => new Date(s.taken_at).getTime() >= cutoff).map((s) => ({ ...s, t: new Date(s.taken_at).getTime() }));
  }, [snaps, range]);

  const growth = useMemo(() => data.map((s, i) => ({
    ...s,
    dLikes: i ? (s.likes ?? 0) - (data[i - 1].likes ?? 0) : 0,
    dViews: i ? (s.views ?? 0) - (data[i - 1].views ?? 0) : 0,
  })), [data]);

  if (!id) return <p>Missing post id.</p>;
  if (failed) return <p className="err">Could not load this post (it may have been deleted).</p>;
  if (!post) return <p className="muted">Loading...</p>;

  const first = data[0], last = data[data.length - 1];
  const periodGain = (k: "likes" | "comments" | "views") => (first && last ? (last[k] ?? 0) - (first[k] ?? 0) : null);

  return (
    <>
      <div className="row">
        <span className={`badge ${post.platform}`}>{PLATFORM_LABEL[post.platform]}</span>
        <h1 style={{ margin: 0, fontSize: 18 }}>{post.title || post.author || post.external_id}</h1>
        <a href={post.url} target="_blank" rel="noreferrer" className="muted">open post</a>
      </div>
      {post.last_error && <p className="err">Last scrape error: {post.last_error}</p>}

      <div className="grid">
        {(["likes", "comments", "views"] as const).map((k) => (
          <div className="card kpi" key={k}>
            <div className="l">{k}</div><div className="v">{fmt(post[k])}</div>
            <span className="muted">{delta(periodGain(k))} in range</span>
          </div>
        ))}
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        {[1, 7, 30, 0].map((d) => (
          <button key={d} className={range === d ? "primary" : ""} onClick={() => setRange(d)}>{d ? `${d}d` : "All"}</button>
        ))}
        <span style={{ flex: 1 }} />
        <button onClick={() => download("snapshots.csv", toCsv(snaps as unknown as Record<string, unknown>[]))}>Export CSV</button>
      </div>

      <div className="card chart">
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tick={{ fontSize: 11 }} minTickGap={50} tickCount={6}
              tickFormatter={(t) => new Date(t).toLocaleString(undefined, range === 1 ? { hour: "numeric" } : { month: "short", day: "numeric" })} />
            <YAxis yAxisId="l" tick={{ fontSize: 11 }} tickFormatter={fmt} />
            <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} tickFormatter={fmt} />
            <Tooltip labelFormatter={(t) => new Date(t as number).toLocaleString()} />
            <Legend />
            <Line type="monotone" yAxisId="l" dataKey="likes" stroke="#e11d48" dot={false} strokeWidth={2} />
            <Line type="monotone" yAxisId="l" dataKey="comments" stroke="#2563eb" dot={false} strokeWidth={2} />
            <Line type="monotone" yAxisId="r" dataKey="views" stroke="#16a34a" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <h2>Edit</h2>
      <div className="row">
        <input placeholder="Campaign" value={campaign} onChange={(e) => setCampaign(e.target.value)} />
        <button onClick={async () => { await api.updatePost(post.id, { campaign }); }}>Save campaign</button>
        <button onClick={async () => { await api.updatePost(post.id, { active: !post.active }); setPost({ ...post, active: !post.active }); }}>
          {post.active ? "Pause tracking" : "Resume tracking"}
        </button>
        <button className="danger" onClick={async () => {
          if (!confirm("Delete this post and all its history?")) return;
          await api.deletePost(post.id);
          router.push("/");
        }}>Delete</button>
      </div>

      <h2>Recent snapshots</h2>
      <div className="card scroll" style={{ padding: 0 }}>
        <table>
          <thead><tr><th className="l">Time</th><th>Likes</th><th>+</th><th>Comments</th><th>Views</th><th>+</th></tr></thead>
          <tbody>
            {[...growth].reverse().slice(0, 50).map((s) => (
              <tr key={s.taken_at}>
                <td className="l">{new Date(s.taken_at).toLocaleString()}</td>
                <td>{fmt(s.likes)}</td><td className={s.dLikes >= 0 ? "up" : "down"}>{delta(s.dLikes)}</td>
                <td>{fmt(s.comments)}</td>
                <td>{fmt(s.views)}</td><td className={s.dViews >= 0 ? "up" : "down"}>{delta(s.dViews)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function Page() {
  return <Suspense fallback={<p className="muted">Loading...</p>}><PostDetail /></Suspense>;
}
