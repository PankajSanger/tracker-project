import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const email = currentUser();
  return NextResponse.json({ email, demo: store.demo }, { status: email ? 200 : 401 });
}
