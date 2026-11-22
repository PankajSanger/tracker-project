// Simple team login: TEAM_USERS="alice@x.com:pass1,bob@x.com:pass2" + a signed, HttpOnly session cookie.
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { store } from "./store";

export const COOKIE = "st_session";
const DAYS = 14;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (store.demo) return "demo-only-secret-not-for-production";
  throw new Error("SESSION_SECRET (16+ chars) is required");
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function makeToken(email: string): string {
  const payload = Buffer.from(JSON.stringify({ e: email, x: Date.now() + DAYS * 864e5 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readToken(token: string | undefined): string | null {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const want = sign(payload);
  if (mac.length !== want.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  try {
    const { e, x } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return x > Date.now() ? String(e) : null;
  } catch { return null; }
}

export function teamUsers(): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of (process.env.TEAM_USERS ?? "").split(",")) {
    const i = part.indexOf(":");
    if (i > 0) m.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
  }
  return m;
}

export function checkLogin(email: string, password: string): { ok: boolean; email: string; error?: string } {
  const users = teamUsers();
  const e = email.trim().toLowerCase();
  if (!users.size) {
    if (store.demo) return { ok: !!e, email: e || "demo@example.com" }; // demo mode: any login
    return { ok: false, email: e, error: "TEAM_USERS is not configured on the server" };
  }
  const want = users.get(e);
  if (!want) return { ok: false, email: e };
  const a = Buffer.from(want), b = Buffer.from(password);
  return { ok: a.length === b.length && timingSafeEqual(a, b), email: e };
}

export function currentUser(): string | null {
  return readToken(cookies().get(COOKIE)?.value);
}

export function sessionCookie(token: string, maxAgeDays = DAYS) {
  return { name: COOKIE, value: token, httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: maxAgeDays * 86400 };
}

/** Wrap an API handler so it only runs for signed-in users. */
export function authed<A extends unknown[]>(fn: (user: string, ...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    const user = currentUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    try {
      return await fn(user, ...args);
    } catch (e: any) {
      return NextResponse.json({ error: String(e?.message ?? e).slice(0, 300) }, { status: 500 });
    }
  };
}
