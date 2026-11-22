import { NextResponse } from "next/server";
import { authed } from "@/lib/server/auth";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export const GET = authed(async (_user, req: Request) => {
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6);
  return NextResponse.json({ series: await store.compare(ids) });
});
