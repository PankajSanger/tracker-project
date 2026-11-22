"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Account, AccountSnap, Platform } from "@/lib/types";
import { ago, delta, fmt, PLATFORM_LABEL } from "@/lib/utils";
import { DeltaChip, Empty, Icon, PlatformMark, Seg, Skeleton, Sparkline, useToast } from "@/components/ui";

const unit = (p: Platform) => (p === "youtube" ? "subscribers" : "followers");

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [snaps, setSnaps] = useState<AccountSnap[]>([]);
  const [handle, setHandle] = useState("");
  const [platform, setPlatform] = useState<Platform>("instagram");
  const { toast, show } = useToast();

  const load = useCallback(async () => {
    try {
      const r = await api.accounts();
      setAccounts(r.accounts);
      setSnaps([...r.snaps].sort((a, b) => a.taken_at.localeCompare(b.taken_at)));
    } catch { setAccounts((a) => a ?? []); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const byAccount = useMemo(() => {
    const m = new Map<string, AccountSnap[]>();
    snaps.forEach((s) => { if (!m.has(s.account_id)) m.set(s.account_id, []); m.get(s.account_id)!.push(s); });
    return m;
  }, [snaps]);

  async function add() {
    if (!handle.trim()) return;
    try { await api.addAccount(platform, handle); setHandle(""); show("Account added. Numbers appear after the next check."); load(); }
    catch (e) { show(e instanceof Error ? e.message : "Could not add account"); }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Accounts</h1><div className="sub">Follower and subscriber growth for the profiles you care about.</div></div>
      </div>

      <div className="card" style={{ marginBottom: 14, padding: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Seg value={platform} onChange={setPlatform} options={[{ value: "instagram", label: "Instagram" }, { value: "youtube", label: "YouTube" }, { value: "twitter", label: "X" }]} />
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="@handle or profile link" value={handle} onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn primary" onClick={add} disabled={!handle.trim()}><Icon name="plus" size={15} /> Track account</button>
      </div>

      {accounts === null ? <div className="grid thirds"><Skeleton h={200} /><Skeleton h={200} /></div> : accounts.length === 0 ? (
        <div className="card"><Empty icon="users" title="No accounts tracked yet">Add a handle above to follow its audience growth over time.</Empty></div>
      ) : (
        <div className="grid thirds">
          {accounts.map((a) => {
            const s = byAccount.get(a.id) ?? [];
            const last = s[s.length - 1];
            const dayAgo = [...s].reverse().find((x) => new Date(x.taken_at).getTime() <= Date.now() - 864e5);
            const weekAgo = [...s].reverse().find((x) => new Date(x.taken_at).getTime() <= Date.now() - 7 * 864e5);
            const d1 = last && dayAgo ? (last.followers ?? 0) - (dayAgo.followers ?? 0) : null;
            const d7 = last && weekAgo ? (last.followers ?? 0) - (weekAgo.followers ?? 0) : null;
            return (
              <div className="card" key={a.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <PlatformMark platform={a.platform} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 650 }}>@{a.handle}</div>
                    <div className="muted small">{PLATFORM_LABEL[a.platform]}</div>
                  </div>
                  <button className="btn icon ghost danger" title="Stop tracking" onClick={async () => { if (confirm(`Stop tracking @${a.handle}?`)) { await api.deleteAccount(a.id); load(); } }}><Icon name="trash" size={15} /></button>
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 30, fontWeight: 750, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{fmt(last?.followers)}</div>
                    <div className="muted small">{unit(a.platform)}{last ? ` · ${ago(last.taken_at)}` : ""}</div>
                  </div>
                  <span style={{ flex: 1 }} />
                  <Sparkline values={s.slice(-40).map((x) => x.followers ?? 0)} width={130} height={48} color="var(--accent)" />
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <span className="chip">24h <b className={(d1 ?? 0) >= 0 ? "up" : "down"}>{d1 === null ? "-" : delta(d1)}</b></span>
                  <span className="chip">7d <b className={(d7 ?? 0) >= 0 ? "up" : "down"}>{d7 === null ? "-" : delta(d7)}</b></span>
                  {d1 !== null && last?.followers ? <DeltaChip value={Number(((d1 / Math.max(last.followers - d1, 1)) * 100).toFixed(2))} suffix="% today" /> : null}
                </div>
                {a.last_error && <div className="small" style={{ color: "var(--warn)", marginTop: 10 }}><Icon name="alert" size={12} /> {a.last_error}</div>}
              </div>
            );
          })}
        </div>
      )}
      {toast}
    </>
  );
}
