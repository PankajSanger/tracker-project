"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ACCOUNT_PERIODS, DEFAULT_SETTINGS } from "@/lib/types";
import type { Platform, Settings } from "@/lib/types";
import { INTERVALS, intervalLabel, PLATFORM_LABEL } from "@/lib/utils";
import { Icon, PlatformMark, Skeleton, useToast } from "@/components/ui";
import { useSession } from "@/components/Shell";

const ROWS: { pf: Platform; key: keyof Settings; runner: string }[] = [
  { pf: "instagram", key: "interval_instagram", runner: "Apify instagram-scraper (likes, comments, reel views)" },
  { pf: "youtube", key: "interval_youtube", runner: "Apify youtube-scraper" },
  { pf: "twitter", key: "interval_twitter", runner: "Apify tweet scraper (needs a paid Apify plan)" },
];

export default function SettingsPage() {
  const session = useSession();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const { toast, show } = useToast();

  useEffect(() => { api.settings().then((s) => { setSaved(s); setDraft(s); }).catch(() => { setSaved(DEFAULT_SETTINGS); }); }, []);

  const dirty = saved !== null && JSON.stringify(saved) !== JSON.stringify(draft);
  const set = (k: keyof Settings, v: number) => setDraft((d) => ({ ...d, [k]: v }));

  async function save() {
    setBusy(true);
    try { const s = await api.saveSettings(draft); setSaved(s); setDraft(s); show("Settings saved. They apply from the next check."); }
    catch (e) { show(e instanceof Error ? e.message : "Could not save"); }
    setBusy(false);
  }

  if (saved === null) return <div className="grid"><Skeleton h={40} w={220} /><Skeleton h={260} /></div>;

  return (
    <>
      <div className="page-head">
        <div><h1>Settings</h1><div className="sub">How often posts are checked, and when you get alerted.</div></div>
        <div className="grow" />
        <button className="btn" disabled={!dirty || busy} onClick={() => setDraft(saved)}>Reset</button>
        <button className="btn primary" disabled={!dirty || busy} onClick={save}><Icon name="save" size={15} /> {busy ? "Saving…" : "Save changes"}</button>
      </div>

      <div className="grid halves" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-head"><Icon name="clock" /><h2>Tracking interval</h2></div>
          <p className="muted" style={{ marginTop: -4 }}>How often each platform's posts are checked. You can also override this for a single post on its page.</p>
          <div className="list">
            {ROWS.map(({ pf, key, runner }) => (
              <div className="list-item" key={pf} style={{ alignItems: "flex-start" }}>
                <PlatformMark platform={pf} size={30} />
                <div className="grow">
                  <div className="t">{PLATFORM_LABEL[pf]}</div>
                  <div className="muted small">{runner}</div>
                </div>
                <select className="select" value={draft[key]} onChange={(e) => set(key, Number(e.target.value))}>
                  {(INTERVALS.includes(draft[key]) ? INTERVALS : [...INTERVALS, draft[key]].sort((a, b) => a - b)).map((m) => <option key={m} value={m}>{intervalLabel(m)}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="muted small" style={{ marginTop: 12 }}>The fastest possible interval is 15 minutes, which is how often the runs start. Every check uses Apify credit, so longer intervals cost less. Use "Check now" on a post for an immediate refresh.</div>
        </div>

        <div className="card">
          <div className="card-head"><Icon name="users" /><h2>Follower tracking</h2></div>
          <p className="muted" style={{ marginTop: -4 }}>How often follower and subscriber counts of tracked accounts are recorded. Separate from the post intervals.</p>
          <div className="pills" role="radiogroup" aria-label="Follower tracking period">
            {ACCOUNT_PERIODS.map((p) => (
              <button key={p.days} role="radio" aria-checked={draft.account_period_days === p.days}
                className={`pill ${draft.account_period_days === p.days ? "on" : ""}`} onClick={() => set("account_period_days", p.days)}>{p.label}</button>
            ))}
          </div>
          <div className="muted small" style={{ marginTop: 12 }}>
            One snapshot per calendar {ACCOUNT_PERIODS.find((p) => p.days === draft.account_period_days)?.noun ?? "day"} (India time), taken by the first run after
            {draft.account_period_days === 365 ? " 1 January" : draft.account_period_days === 30 ? " the 1st of the month" : draft.account_period_days === 7 ? " Monday 00:00" : " midnight"}.
            A newly added account is checked on the next run.
          </div>
        </div>

        <div className="card">
          <div className="card-head"><Icon name="bell" /><h2>Alert thresholds</h2></div>
          <p className="muted" style={{ marginTop: -4 }}>An alert is created when a metric changes by at least this much between two checks.</p>
          <div className="form-grid">
            <label>
              Change of at least (%)
              <input className="input" type="number" min={1} value={draft.alert_spike_pct} onChange={(e) => set("alert_spike_pct", Number(e.target.value))} />
              <small>e.g. 25 means a 25% jump or drop</small>
            </label>
            <label>
              and at least (count)
              <input className="input" type="number" min={1} value={draft.alert_spike_min} onChange={(e) => set("alert_spike_min", Number(e.target.value))} />
              <small>ignores tiny posts where 3 likes is +50%</small>
            </label>
          </div>
        </div>
      </div>

      <div className="grid halves">
        <div className="card">
          <div className="card-head"><Icon name="sheet" /><h2>Your data</h2></div>
          <p className="muted" style={{ marginTop: -4 }}>Everything is stored in a Google Sheet you own: posts, every snapshot, accounts and alerts.</p>
          {session.sheetUrl ? <a className="btn" href={session.sheetUrl} target="_blank" rel="noreferrer"><Icon name="external" size={15} /> Open the Google Sheet</a> : <span className="chip warn">Demo mode: no sheet connected</span>}
        </div>
        <div className="card">
          <div className="card-head"><Icon name="users" /><h2>Team</h2></div>
          <p className="muted" style={{ marginTop: -4 }}>Signed in as <b style={{ color: "var(--text)" }}>{session.email}</b>. Everyone on the team shares the same posts and settings.</p>
          <div className="muted small">To add or remove teammates, edit the <code>TEAM_USERS</code> setting in your Vercel project and redeploy.</div>
        </div>
      </div>
      {toast}
    </>
  );
}
