import { NextResponse } from "next/server";
import { authed } from "@/lib/server/auth";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export const DELETE = authed(async (_user, _req: Request, { params }: { params: { id: string } }) => {
  await store.deleteAccount(params.id);
  return NextResponse.json({ ok: true });
});
