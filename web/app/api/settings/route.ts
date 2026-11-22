import { NextResponse } from "next/server";
import { authed } from "@/lib/server/auth";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export const GET = authed(async () => NextResponse.json(await store.getSettings()));

export const PUT = authed(async (_user, req: Request) => {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await store.setSettings(body));
});
