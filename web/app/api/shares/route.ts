// Read-only client report links (team only): list, create, revoke.
import { NextResponse } from "next/server";
import { authed } from "@/lib/server/auth";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export const GET = authed(async () => NextResponse.json(await store.listShares()));

export const POST = authed(async (user, req: Request) => {
  const body = await req.json().catch(() => ({}));
  const campaign = typeof body.campaign === "string" && body.campaign.trim() ? body.campaign.trim().slice(0, 120) : null;
  return NextResponse.json(await store.createShare(campaign, user));
});

export const DELETE = authed(async (_user, req: Request) => {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[\w-]{16,64}$/.test(token)) return NextResponse.json({ error: "Bad token" }, { status: 400 });
  await store.revokeShare(token);
  return NextResponse.json({ ok: true });
});
