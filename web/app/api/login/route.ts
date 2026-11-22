import { NextResponse } from "next/server";
import { checkLogin, makeToken, sessionCookie } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { email = "", password = "" } = await req.json().catch(() => ({}));
  const r = checkLogin(String(email), String(password));
  if (!r.ok) {
    await new Promise((res) => setTimeout(res, 700)); // slow down password guessing
    return NextResponse.json({ error: r.error ?? "Wrong email or password" }, { status: r.error ? 503 : 401 });
  }
  const res = NextResponse.json({ email: r.email });
  res.cookies.set(sessionCookie(makeToken(r.email)));
  return res;
}
