// Auto-track: accounts whose new posts are added automatically by the scraper.
import { NextResponse } from "next/server";
import { authed } from "@/lib/server/auth";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

const INTERVALS = [60, 180, 360, 720, 1440];
const BACKFILL = [0, 3, 7, 30];

/** "@name", "name" or a profile link (instagram.com/name, youtube.com/@name, x.com/name) -> "name". */
function cleanHandle(raw: unknown): string {
  return String(raw ?? "").trim().replace(/^@/, "")
    .replace(/^.*?(?:instagram|twitter|x|youtube)\.com\/(?:@)?/i, "")
    .replace(/[/?#].*$/, "");
}

export const GET = authed(async () => NextResponse.json(await store.listWatches()));

export const POST = authed(async (user, req: Request) => {
  const b = await req.json().catch(() => ({}));
  const handle = cleanHandle(b.handle);
  if (!["instagram", "twitter", "youtube"].includes(b.platform) || !/^[\w.-]{1,60}$/.test(handle))
    return NextResponse.json({ error: "Enter a valid @handle or profile link" }, { status: 400 });
  const interval = INTERVALS.includes(Number(b.interval_min)) ? Number(b.interval_min) : 180;
  const backfill = BACKFILL.includes(Number(b.backfill_days)) ? Number(b.backfill_days) : 0;
  const campaign = typeof b.campaign === "string" && b.campaign.trim() ? b.campaign.trim().slice(0, 120) : null;
  const r = await store.addWatch({ platform: b.platform, handle, campaign, interval_min: interval, backfill_days: backfill }, user);
  if (!r.added) return NextResponse.json({ error: `@${handle} is already auto-tracked` }, { status: 409 });
  return NextResponse.json(r);
});
