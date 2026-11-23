"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import Link from "next/link";
import { ACCOUNT_PERIODS } from "@/lib/types";
import type { Account, AccountSnap, Platform } from "@/lib/types";
import { ago, delta, fmt, PLATFORM_LABEL } from "@/lib/utils";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DeltaChip, Empty, Icon, PlatformMark, Seg, Skeleton, Sparkline, useToast } from "@/components/ui";
import { AXIS, GRID, TipCard } from "@/components/charts";

const unit = (p: Platform) => (p === "youtube" ? "subscribers" : "followers");

type Range = "7d" | "30d" | "90d" | "1y" | "all";
const RANGE_MS: Record<Exclude<Range, "all">, number> = { "7d": 7 * 864e5, "30d": 30 * 864e5, "90d": 90 * 864e5, "1y": 365 * 864e5 };
/** A range that holds several snapshots for the chosen follower period. */
const defaultRange = (periodDays: number): Range => (periodDays <= 1 ? "30d" : periodDays <= 7 ? "90d" : "all");
interface Pt { t: number; v: number }

/** Full-size follower chart for one account: range picker, total line or growth-per-period bars. */
function AccountChart({ account, snaps, periodDays }: { account: Account; snaps: AccountSnap[]; periodDays: number }) {
  const [range, setRange] = useState<Range>(defaultRange(periodDays));
  const [mode, setMode] = useState<"total" | "growth">("total");

  const points = useMemo(() => {
    const lo = range === "all" ? 0 : Date.now() - RANGE_MS[range];
    const all: Pt[] = snaps.filter((s) => s.followers !== null).map((s) => ({ t: new Date(s.taken_at).getTime(), v: s.followers as number })).filter((p) => p.t >= lo);
    const span = all.length ? all[all.length - 1].t - all[0].t : 0;
    if (span <= 2 * 864e5) return all; // every check
    const day = span > 21 * 864e5;
    const out = new Map<number, Pt>(); // last value of each hour / day
    for (const p of all) {
      const k = day ? new Date(p.t).setHours(0, 0, 0, 0) : Math.floor(p.t / 36e5) * 36e5;
      out.set(k, { t: k, v: p.v });
    }
    return Array.from(out.values()).sort((a, b) => a.t - b.t);
  }, [snaps, range]);

  const data = useMemo(() => (mode === "total" ? points : points.slice(1).map((p, i) => ({ t: p.t, v: p.v - points[i].v }))), [points, mode]);
  const first = points[0], last = points[points.length - 1];
  const gained = points.length >= 2 ? last.v - first.v : null;
  const hours = points.length >= 2 ? (last.t - first.t) / 36e5 : 0;
  const perDay = gained !== null && hours >= 1 ? (gained / hours) * 24 : null;
  const short = points.length > 1 && last.t - first.t <= 2 * 864e5;
  const xFmt = (t: number) => new Date(t).toLocaleString(undefined, short ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" });

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-head" style={{ flexWrap: "wrap" }}>
        <PlatformMark platform={account.platform} size={22} />
        <h2>@{account.handle} · {unit(account.platform)}</h2>
        <span className="grow" />
        <Seg value={mode} onChange={setMode} options={[{ value: "total", label: "Total" }, { value: "growth", label: "Growth" }]} />
      </div>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <Seg value={range} onChange={setRange} options={[{ value: "7d", label: "7d" }, { value: "30d", label: "30d" }, { value: "90d", label: "90d" }, { value: "1y", label: "1y" }, { value: "all", label: "All" }]} />
        <span className="grow" />
        <span className="chip">in range <b className={(gained ?? 0) >= 0 ? "up" : "down"}>{gained === null ? "-" : delta(gained)}</b></span>
        <span className="chip">per day <b className={(perDay ?? 0) >= 0 ? "up" : "down"}>{perDay === null ? "-" : delta(Math.round(perDay))}</b></span>
        {gained !== null && first.v > 0 && <DeltaChip value={Number(((gained / first.v) * 100).toFixed(2))} suffix="%" />}
      </div>
      <div className="chart-box">
        {data.length < 2 ? <Empty icon="clock" title="Not enough data in this range yet">Try a longer range, or wait for the next check.</Empty> : (
          <ResponsiveContainer>
            {mode === "total" ? (
              <LineChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tick={AXIS} axisLine={false} tickLine={false} minTickGap={50} tickFormatter={xFmt} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} width={72} tickFormatter={(v: number) => v.toLocaleString()} domain={["auto", "auto"]} allowDecimals={false} />
                <Tooltip content={({ active, payload }) => active && payload?.length ? (
                  <TipCard title={new Date(payload[0].payload.t).toLocaleString()} rows={[{ label: unit(account.platform), value: Number(payload[0].value).toLocaleString(), color: "var(--accent)" }]} />
                ) : null} />
                <Line type="monotone" dataKey="v" stroke="var(--accent)" strokeWidth={2.4} dot={data.length < 40 ? { r: 2.5 } : false} isAnimationActive={false} />
              </LineChart>
            ) : (
              <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} padding={{ left: 12, right: 12 }} tick={AXIS} axisLine={false} tickLine={false} minTickGap={50} tickFormatter={xFmt} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} width={56} tickFormatter={(v: number) => delta(v)} allowDecimals={false} />
                <Tooltip cursor={{ fill: "var(--accent-soft)" }} content={({ active, payload }) => active && payload?.length ? (
                  <TipCard title={new Date(payload[0].payload.t).toLocaleString()} rows={[{ label: "change", value: delta(Number(payload[0].value)), color: Number(payload[0].value) >= 0 ? "var(--good)" : "var(--bad)" }]} />
                ) : null} />
                <Bar dataKey="v" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false}>
                  {data.map((d, i) => <Cell key={i} fill={d.v >= 0 ? "var(--good)" : "var(--bad)"} />)}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
      {account.platform === "youtube" && <div className="muted small" style={{ marginTop: 8 }}>YouTube only publishes rounded subscriber counts (e.g. 1.68M), so this line moves in steps.</div>}
    </div>
  );
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [snaps, setSnaps] = useState<AccountSnap[]>([]);
  const [handle, setHandle] = useState("");
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [selected, setSelected] = useState<string | null>(null);
  const [periodDays, setPeriodDays] = useState(1);
  const { toast, show } = useToast();

  const load = useCallback(async () => {
    try {
      const r = await api.accounts();
      setAccounts(r.accounts);
      setSnaps([...r.snaps].sort((a, b) => a.taken_at.localeCompare(b.taken_at)));
    } catch { setAccounts((a) => a ?? []); }
  }, []);
  useEffect(() => { load(); api.settings().then((s) => setPeriodDays(s.account_period_days || 1)).catch(() => {}); }, [load]);
  const period = ACCOUNT_PERIODS.find((p) => p.days === periodDays) ?? ACCOUNT_PERIODS[0];

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
        <div><h1>Accounts</h1><div className="sub">Follower and subscriber growth for the profiles you care about. Recorded <b>{period.label.toLowerCase()}</b> · <Link href="/settings" className="up">change</Link></div></div>
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
            const prev = s.length >= 2 ? s[s.length - 2] : undefined;
            const d = last?.followers != null && prev?.followers != null ? last.followers - prev.followers : null;
            const since = prev ? new Date(prev.taken_at).toLocaleDateString(undefined, { day: "numeric", month: "short", ...(periodDays >= 30 ? { year: "numeric" } : {}) }) : null;
            const isSel = a.id === (selected ?? accounts[0].id);
            return (
              <div className="card" key={a.id} role="button" tabIndex={0} title="Show the full chart"
                onClick={() => setSelected(a.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSelected(a.id)}
                style={{ cursor: "pointer", outline: isSel && accounts.length > 1 ? "2px solid var(--accent)" : undefined, outlineOffset: -1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <PlatformMark platform={a.platform} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 650 }}>@{a.handle}</div>
                    <div className="muted small">{PLATFORM_LABEL[a.platform]}</div>
                  </div>
                  <button className="btn icon ghost danger" title="Stop tracking" onClick={async (e) => { e.stopPropagation(); if (confirm(`Stop tracking @${a.handle}?`)) { await api.deleteAccount(a.id); load(); } }}><Icon name="trash" size={15} /></button>
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
                  <span className="chip">{since ? `since ${since}` : "since last check"} <b className={(d ?? 0) >= 0 ? "up" : "down"}>{d === null ? "-" : delta(d)}</b></span>
                  {d !== null && prev?.followers ? <DeltaChip value={Number(((d / Math.max(prev.followers, 1)) * 100).toFixed(2))} suffix="%" /> : null}
                  <span className="chip">checked {period.label.toLowerCase()}</span>
                </div>
                {a.last_error && <div className="small" style={{ color: "var(--warn)", marginTop: 10 }}><Icon name="alert" size={12} /> {a.last_error}</div>}
              </div>
            );
          })}
        </div>
      )}
      {accounts && accounts.length > 0 && (() => {
        const acc = accounts.find((a) => a.id === selected) ?? accounts[0];
        return <AccountChart key={`${acc.id}-${periodDays}`} account={acc} snaps={byAccount.get(acc.id) ?? []} periodDays={periodDays} />;
      })()}
      {toast}
    </>
  );
}
