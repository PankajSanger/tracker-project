"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ago } from "@/lib/utils";

interface Alert { id: number; created_at: string; kind: string; message: string }

export default function Alerts() {
  const [rows, setRows] = useState<Alert[]>([]);
  useEffect(() => {
    api.alerts().then(setRows).catch(() => setRows([]));
  }, []);

  return (
    <>
      <p className="muted">Spikes and drops detected between scrape runs (default: 25% and at least 50). Add a Telegram bot in the scraper settings to also get these on your phone.</p>
      <div className="card scroll" style={{ padding: 0 }}>
        <table>
          <tbody>
            {!rows.length && <tr><td className="muted">No alerts yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="l"><span className={r.kind === "spike" ? "up" : "down"}>{r.kind}</span></td>
                <td className="l" style={{ whiteSpace: "normal" }}>{r.message}</td>
                <td className="muted">{ago(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
