"use client";
import { useEffect, useState, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";

export default function AuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<{ email: string; demo: boolean } | null>(null);
  const [demo, setDemo] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const path = usePathname();

  useEffect(() => {
    api.me().then(setMe).catch((e) => { setMe(null); setDemo(!!e?.demo); }).finally(() => setReady(true));
  }, []);

  if (!ready) return <div className="center muted">Loading...</div>;

  if (!me)
    return (
      <div className="center">
        <form
          className="card login"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.login(email, password);
              setMe(await api.me());
              setErr("");
            } catch (ex) {
              setErr(ex instanceof Error ? ex.message : "Sign-in failed");
            }
          }}
        >
          <h1>Social Tracker</h1>
          {demo && <p className="muted" style={{ margin: 0 }}>Demo mode (sample data). Enter any email and password.</p>}
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {err && <p className="err">{err}</p>}
          <button className="primary">Sign in</button>
        </form>
      </div>
    );

  const tabs: [string, string][] = [
    ["/", "Posts"],
    ["/accounts", "Accounts"],
    ["/alerts", "Alerts"],
  ];
  return (
    <>
      <header className="nav">
        <strong>Social Tracker{me.demo ? " (demo)" : ""}</strong>
        <nav>
          {tabs.map(([href, label]) => (
            <Link key={href} href={href} className={(path || "/").replace(/(.)\/$/, "$1") === href ? "active" : ""}>
              {label}
            </Link>
          ))}
        </nav>
        <span className="muted" style={{ fontSize: 12 }}>{me.email}</span>
        <button onClick={async () => { await api.logout(); setMe(null); }}>Sign out</button>
      </header>
      <main>{children}</main>
    </>
  );
}
