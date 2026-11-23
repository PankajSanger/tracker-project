// Campaign report data.
//   ?t=<share token>          public, read-only (a client's link) - the campaign comes from the link, never from the URL
//   ?c=<campaign> | (none)    team members only; no c = all posts
//   &days=7|30|90|0           period for the growth numbers (0 = all time)
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const d = Number(q.get("days") ?? 30);
    const days = [0, 7, 30, 90].includes(d) ? d : 30;
    const token = q.get("t");
    if (token) {
      const share = /^[\w-]{16,64}$/.test(token) ? await store.getShare(token) : null;
      if (!share) return NextResponse.json({ error: "This report link is invalid or has been revoked." }, { status: 404 });
      return NextResponse.json(await store.report(share.campaign, days, true), { headers: { "Cache-Control": "private, max-age=60" } });
    }
    if (!currentUser()) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const c = q.get("c");
    return NextResponse.json(await store.report(c === null ? null : c, days, false));
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
