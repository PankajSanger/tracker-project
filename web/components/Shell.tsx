"use client";
import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { Icon, PlatformMark } from "./ui";

export interface Session { email: string; demo: boolean; sheetUrl: string | null }
const Ctx = createContext<Session | null>(null);
export const useSession = () => useContext(Ctx)!;

type Theme = "auto" | "light" | "dark";
function applyTheme(t: Theme) {
  const r = document.documentElement;
  if (t === "auto") r.removeAttribute("data-theme");
  else r.setAttribute("data-theme", t);
}

const NAV: [string, string, string][] = [
  ["/", "Overview", "grid"],
  ["/posts", "Posts", "list"],
  ["/compare", "Compare", "bars"],
  ["/accounts", "Accounts", "users"],
  ["/autotrack", "Auto-track", "zap"],
  ["/reports", "Reports", "report"],
  ["/alerts", "Alerts", "bell"],
  ["/settings", "Settings", "sliders"],
];
const SECTIONS: [string, string[]][] = [["Analytics", ["/", "/posts", "/compare", "/accounts", "/autotrack"]], ["Clients", ["/reports"]], ["Workspace", ["/alerts", "/settings"]]];

export default function Shell({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Session | null>(null);
  const [demo, setDemo] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<Theme>("auto");
  const path = usePathname() || "/";

  useEffect(() => {
    try { const t = (localStorage.getItem("st-theme") as Theme) || "auto"; setTheme(t); applyTheme(t); } catch { /* ignore */ }
    api.me().then(setMe).catch((e) => { setMe(null); setDemo(!!e?.demo); }).finally(() => setReady(true));
  }, []);

  const cycleTheme = () => {
    const next: Theme = theme === "auto" ? "dark" : theme === "dark" ? "light" : "auto";
    setTheme(next); applyTheme(next);
    try { localStorage.setItem("st-theme", next); } catch { /* ignore */ }
  };
  const themeIcon = theme === "dark" ? "moon" : theme === "light" ? "sun" : "layers";
  const themeTitle = `Theme: ${theme} (click to change)`;

  // The report page is standalone: clients open it through a share link without logging in (it checks access itself).
  if (path === "/report") return <>{children}</>;

  if (!ready) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }} className="muted">Loading…</div>;

  if (!me)
    return (
      <div className="login-wrap">
        <div className="login-hero">
          <div className="brand" style={{ padding: 0 }}><span className="logo"><Icon name="trend" size={19} /></span><span>Social Tracker<small>Performance analytics</small></span></div>
          <h1>Campaign performance across every platform, in one place.</h1>
          <p>Live likes, comments, views and follower growth for Instagram, YouTube and X. Spot spikes early and report results with confidence.</p>
          <ul>
            <li><PlatformMark platform="instagram" size={26} /> Instagram posts and reels</li>
            <li><PlatformMark platform="youtube" size={26} /> YouTube videos and Shorts</li>
            <li><PlatformMark platform="twitter" size={26} /> X posts</li>
          </ul>
          <div className="login-stats">
            <div><b>3</b><span>platforms</span></div>
            <div><b>15 min</b><span>refresh cycle</span></div>
            <div><b>24/7</b><span>automated tracking</span></div>
          </div>
        </div>
        <div className="login-form-side">
          <form
            className="login-card"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try { await api.login(email, password); setMe(await api.me()); setErr(""); }
              catch (ex) { setErr(ex instanceof Error ? ex.message : "Sign-in failed"); }
              setBusy(false);
            }}
          >
            <h2>Sign in</h2>
            <div className="muted" style={{ marginTop: -6 }}>{demo ? "Demo mode: sample data. Any email and password works." : "Use your team account to continue."}</div>
            <label>Email<input className="input" type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="username" /></label>
            <label>Password<input className="input" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></label>
            {err && <div className="err small">{err}</div>}
            <button className="btn primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          </form>
        </div>
      </div>
    );

  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const initials = me.email.slice(0, 2).toUpperCase();
  const link = ([href, label, icon]: [string, string, string]) => (
    <Link key={href} href={href} className={`nav-link ${active(href) ? "active" : ""}`}>
      <Icon name={icon} size={17} /> {label}
    </Link>
  );
  const links = NAV.map(link);
  const sectioned = SECTIONS.map(([title, hrefs]) => (
    <div key={title}>
      <div className="nav-section">{title}</div>
      {NAV.filter(([h]) => hrefs.includes(h)).map(link)}
    </div>
  ));

  return (
    <Ctx.Provider value={me}>
      <div className="topbar">
        <span className="logo" style={{ width: 30, height: 30 }}><Icon name="trend" size={16} /></span>
        {links}
        <button className="btn icon ghost" onClick={cycleTheme} title={themeTitle}><Icon name={themeIcon} size={16} /></button>
      </div>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand"><span className="logo"><Icon name="trend" size={19} /></span><span>Social Tracker<small>Performance analytics</small></span></div>
          {sectioned}
          <div className="spacer" />
          <div className="user-card">
            {me.demo && <span className="chip warn" style={{ justifySelf: "start" }}>Demo data</span>}
            <div className="who"><span className="avatar">{initials}</span><span style={{ minWidth: 0 }}><span className="email" title={me.email} style={{ display: "block" }}>{me.email}</span><span className="role">Team member</span></span></div>
            <div className="row-actions">
              <button className="btn sm" style={{ flex: 1 }} onClick={cycleTheme} title={themeTitle}><Icon name={themeIcon} size={14} /> {theme}</button>
              <button className="btn sm" title="Sign out" onClick={async () => { await api.logout(); setMe(null); }}><Icon name="logout" size={14} /></button>
            </div>
          </div>
        </aside>
        <main className="main">{children}</main>
      </div>
    </Ctx.Provider>
  );
}
