import { NextResponse } from "next/server";
import { authed } from "@/lib/server/auth";
import { store, type WatchPatch } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export const PATCH = authed(async (_user, req: Request, { params }: { params: { id: string } }) => {
  const b = await req.json().catch(() => ({}));
  const patch: WatchPatch = {};
  if (typeof b.active === "boolean") patch.active = b.active;
  if (b.interval_min === null || [60, 180, 360, 720, 1440].includes(Number(b.interval_min))) patch.interval_min = b.interval_min === null ? null : Number(b.interval_min);
  if (b.campaign === null || typeof b.campaign === "string") patch.campaign = b.campaign ? String(b.campaign).trim().slice(0, 120) || null : null;
  await store.updateWatch(params.id, patch);
  return NextResponse.json({ ok: true });
});

export const DELETE = authed(async (_user, _req: Request, { params }: { params: { id: string } }) => {
  await store.deleteWatch(params.id);
  return NextResponse.json({ ok: true });
});
