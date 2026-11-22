import { NextResponse } from "next/server";
import { authed } from "@/lib/server/auth";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export const GET = authed(async (_user, req: Request) => {
  const days = Number(new URL(req.url).searchParams.get("days") ?? 7);
  return NextResponse.json(await store.overview(Number.isFinite(days) && days >= 0 ? Math.min(days, 3650) : 7));
});
