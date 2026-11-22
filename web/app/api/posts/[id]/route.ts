import { NextResponse } from "next/server";
import { authed } from "@/lib/server/auth";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export const GET = authed(async (_user, _req: Request, { params }: Ctx) => {
  const post = await store.getPost(params.id);
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });
  return NextResponse.json({ post, snapshots: await store.snapshots(params.id) });
});

export const PATCH = authed(async (_user, req: Request, { params }: Ctx) => {
  const b = await req.json().catch(() => ({}));
  const patch: { campaign?: string | null; active?: boolean } = {};
  if ("campaign" in b) patch.campaign = String(b.campaign ?? "").trim().slice(0, 60) || null;
  if ("active" in b) patch.active = !!b.active;
  await store.updatePost(params.id, patch);
  return NextResponse.json({ ok: true });
});

export const DELETE = authed(async (_user, _req: Request, { params }: Ctx) => {
  await store.deletePost(params.id);
  return NextResponse.json({ ok: true });
});
