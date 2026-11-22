"use client";
import { useCallback, useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import type { Platform } from "@/lib/types";
import { fmt, delta, ago, PLATFORM_SHORT } from "@/lib/utils";

interface Account { id: string; platform: Platform; handle: string; active: boolean; last_error: string | null }
interface Snap { account_id: string; taken_at: string; followers: number | null }

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [handle, setHandle] = useState("");
  const [platform, setPlatform] = useState<Platform>("instagram");

  const load = useCallback(async () => {
    const r = await api.accounts();
    setAccounts(r.accounts);
    setSnaps([...r.snaps].sort((a, b) => a.taken_at.localeCompare(b.taken_at)));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!handle.trim()) return;
    await api.addAccount(platform, handle);
    setHandle("");
    load();
  }

  return (
    <>
      <div className="card row">
        <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
          <option value="instagram">Instagram</option><option value="twitter">X / Twitter</option><option value="youtube">YouTube</option>
        </select>
        <input placeholder="@handle or profile URL" value={handle} onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="primary" onClick={add}>Track account</button>
      </div>

      {!accounts.length && <p className="muted">No accounts yet. Follower counts are recorded every scrape run.</p>}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))" }}>
        {accounts.map((a) => {
          const mine = snaps.filter((s) => s.account_id === a.id).map((s) => ({ t: new Date(s.taken_at).getTime(), followers: s.followers, at: s.taken_at }));
          const last = mine[mine.length - 1];
          const dayAgo = [...mine].reverse().find((s) => s.t <= Date.now() - 864e5);
          return (
            <div className="card" key={a.id}>
              <div className="row">
                <span className={`badge ${a.platform}`}>{PLATFORM_SHORT[a.platform]}</span>
                <strong>@{a.handle}</strong><span style={{ flex: 1 }} />
                <button className="danger" onClick={async () => { if (confirm(`Stop tracking @${a.handle}?`)) { await api.deleteAccount(a.id); load(); } }}>Remove</button>
              </div>
              <div className="kpi"><div className="v">{fmt(last?.followers)}</div>
                <span className="muted">{a.platform === "youtube" ? "subscribers" : "followers"} - {ago(last?.at ?? null)} </span>
                {last && dayAgo && <span className={(last.followers ?? 0) - (dayAgo.followers ?? 0) >= 0 ? "up" : "down"}>{delta((last.followers ?? 0) - (dayAgo.followers ?? 0))} / 24h</span>}
              </div>
              {a.last_error && <p className="err">{a.last_error}</p>}
              <div style={{ height: 160, marginTop: 8 }}>
                <ResponsiveContainer>
                  <LineChart data={mine}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} hide />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} tickFormatter={fmt} width={44} />
                    <Tooltip labelFormatter={(t) => new Date(t as number).toLocaleString()} />
                    <Line dataKey="followers" stroke="var(--accent)" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
