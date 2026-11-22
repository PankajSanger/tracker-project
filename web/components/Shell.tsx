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
  ["/alerts", "Alerts", "bell"],
  ["/settings", "Settings", "sliders"],
];

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

  if (!ready) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }} className="muted">Loading…</div>;

  if (!me)
    return (
      <div className="login-wrap">
        <div className="login-hero">
          <div className="brand" style={{ padding: 0 }}><span className="logo"><Icon name="trend" size={19} /></span> Social Tracker</div>
          <h1>Every post. Every platform. One live dashboard.</h1>
          <p>Track likes, comments and views across Instagram, YouTube and X, spot spikes early and see what is really working for your team.</p>
          <ul>
            <li><PlatformMark platform="instagram" size={26} /> Instagram posts and reels</li>
            <li><PlatformMark platform="youtube" size={26} /> YouTube videos and Shorts</li>
            <li><PlatformMark platform="twitter" size={26} /> X posts</li>
          </ul>
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
            <h2>Welcome back</h2>
            <div className="muted">{demo ? "Demo mode: sample data. Any email and password works." : "Sign in with your team account."}</div>
            <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            {err && <div className="err small">{err}</div>}
            <button className="btn primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          </form>
        </div>
      </div>
    );

  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const initials = me.email.slice(0, 2).toUpperCase();
  const links = NAV.map(([href, label, icon]) => (
    <Link key={href} href={href} className={`nav-link ${active(href) ? "active" : ""}`}>
      <Icon name={icon} size={18} /> {label}
    </Link>
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
          <div className="brand"><span className="logo"><Icon name="trend" size={19} /></span> Social Tracker</div>
          {links}
          <div className="spacer" />
          <div className="user-card">
            {me.demo && <span className="chip warn" style={{ justifySelf: "start" }}>Demo data</span>}
            <div className="who"><span className="avatar">{initials}</span><span className="email" title={me.email}>{me.email}</span></div>
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
