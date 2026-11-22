// Minimal Google Sheets v4 client (service account). Server-side only.
import { JWT } from "google-auth-library";

const API = "https://sheets.googleapis.com/v4/spreadsheets";

export const TABS: Record<string, string[]> = {
  st_posts: ["id", "platform", "url", "external_id", "title", "author", "campaign", "added_by", "active", "last_error", "created_at"],
  st_snapshots: ["post_id", "taken_at", "likes", "comments", "views", "shares"],
  st_summary: ["post_id", "last_taken_at", "likes", "comments", "views", "shares", "hist"],
  st_accounts: ["id", "platform", "handle", "active", "last_error", "created_at"],
  st_account_snapshots: ["account_id", "taken_at", "followers", "following", "posts_count"],
  st_alerts: ["created_at", "post_id", "kind", "message"],
};

export type Row = Record<string, string>;

export function sheetsConfigured(): boolean {
  return !!(process.env.SPREADSHEET_ID && (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_B64));
}

let jwt: JWT | null = null;
function client(): JWT {
  if (!jwt) {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_B64 ?? "", "base64").toString("utf8");
    const info = JSON.parse(raw);
    jwt = new JWT({ email: info.client_email, key: info.private_key, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  }
  return jwt;
}

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const { token } = await client().getAccessToken();
  const res = await fetch(`${API}/${process.env.SPREADSHEET_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

const colLetter = (n: number) => {
  let s = "";
  while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

let ensured: Promise<void> | null = null;
export function ensureTabs(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const meta = await call("GET", "?fields=sheets.properties.title");
      const have = new Set<string>((meta.sheets ?? []).map((s: any) => s.properties.title));
      const missing = Object.keys(TABS).filter((t) => !have.has(t));
      if (missing.length) await call("POST", ":batchUpdate", { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) });
      for (const t of Object.keys(TABS)) {
        const first = await call("GET", `/values/${t}!A1:A1`);
        if (!first.values) await call("PUT", `/values/${t}!A1?valueInputOption=RAW`, { values: [TABS[t]] });
      }
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

export async function readTab(tab: string): Promise<Row[]> {
  await ensureTabs();
  const header = TABS[tab];
  const data = await call("GET", `/values/${tab}!A2:${colLetter(header.length)}?majorDimension=ROWS`);
  return (data.values ?? []).map((r: string[]) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

export async function appendRows(tab: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  await ensureTabs();
  const values = rows.map((r) => TABS[tab].map((h) => (r[h] === null || r[h] === undefined ? "" : r[h])));
  await call("POST", `/values/${tab}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { values });
}

async function rowOf(tab: string, id: string): Promise<number | null> {
  const ids = await call("GET", `/values/${tab}!A2:A`);
  const i = ((ids.values ?? []) as string[][]).findIndex((r) => r[0] === id);
  return i < 0 ? null : i + 2;
}

export async function updateCells(tab: string, id: string, cols: Record<string, string>): Promise<void> {
  await ensureTabs();
  const row = await rowOf(tab, id);
  if (!row) throw new Error("not found");
  const data = Object.entries(cols).map(([name, val]) => ({ range: `${tab}!${colLetter(TABS[tab].indexOf(name) + 1)}${row}`, values: [[val]] }));
  await call("POST", "/values:batchUpdate", { valueInputOption: "RAW", data });
}

export async function deleteRowById(tab: string, id: string): Promise<void> {
  await ensureTabs();
  const row = await rowOf(tab, id);
  if (!row) return;
  const meta = await call("GET", "?fields=sheets.properties(sheetId,title)");
  const sheetId = meta.sheets.find((s: any) => s.properties.title === tab)?.properties.sheetId;
  await call("POST", ":batchUpdate", {
    requests: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: row - 1, endIndex: row } } }],
  });
}
