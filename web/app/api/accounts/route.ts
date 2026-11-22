import { NextResponse } from "next/server";
import { authed } from "@/lib/server/auth";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export const GET = authed(async () => NextResponse.json(await store.listAccounts()));

export const POST = authed(async (_user, req: Request) => {
  const { platform, handle } = await req.json().catch(() => ({}));
  const h = String(handle ?? "").trim().replace(/^@/, "").replace(/.*(?:instagram|twitter|x|youtube)\.com\/(?:@)?/, "").replace(/[/?].*$/, "");
  if (!["instagram", "twitter", "youtube"].includes(platform) || !/^[\w.-]{1,60}$/.test(h))
    return NextResponse.json({ error: "Invalid platform or handle" }, { status: 400 });
  await store.addAccount(platform, h);
  return NextResponse.json({ ok: true });
});
