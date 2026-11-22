import { NextResponse } from "next/server";
import { authed } from "@/lib/server/auth";
import { store } from "@/lib/server/store";
import { parsePostUrl } from "@/lib/utils";
import type { NewPost } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = authed(async () => NextResponse.json(await store.listPosts()));

export const POST = authed(async (user, req: Request) => {
  const { urls = [], campaign = "" } = await req.json().catch(() => ({}));
  const rows: NewPost[] = [];
  const bad: string[] = [];
  for (const u of (urls as unknown[]).slice(0, 200)) {
    const p = parsePostUrl(String(u));
    if (!p) bad.push(String(u).slice(0, 80));
    else rows.push({ ...p, campaign: String(campaign).trim().slice(0, 60) || null });
  }
  const result = rows.length ? await store.addPosts(rows, user) : { added: 0, skipped: 0 };
  return NextResponse.json({ ...result, bad });
});
