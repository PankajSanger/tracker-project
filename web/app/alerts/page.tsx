"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { AlertRow } from "@/lib/types";
import { ago, dayLabel } from "@/lib/utils";
import { Empty, Icon, PlatformMark, Seg, Skeleton } from "@/components/ui";

// Scraper messages look like: "instagram spike: likes 410 -> 560 (+37%) https://..."
const RE = /^(\w+) (spike|drop): (\w+) ([\d,]+) -> ([\d,]+) \(([+-]?\d+)%\)\s*(\S*)/;

export default function AlertsPage() {
  const [rows, setRows] = useState<AlertRow[] | null>(null);
  const [kind, setKind] = useState<"all" | "spike" | "drop">("all");
  useEffect(() => { api.alerts().then(setRows).catch(() => setRows([])); }, []);

  const groups = useMemo(() => {
    const m = new Map<string, AlertRow[]>();
    (rows ?? []).filter((r) => kind === "all" || r.kind === kind).forEach((r) => {
      const k = dayLabel(r.created_at);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    });
    return Array.from(m.entries());
  }, [rows, kind]);

  return (
    <>
      <div className="page-head">
        <div><h1>Alerts</h1><div className="sub">Sudden jumps and drops detected between checks. Thresholds are set in Settings.</div></div>
        <div className="grow" />
        <Seg value={kind} onChange={setKind} options={[{ value: "all", label: "All" }, { value: "spike", label: "Spikes" }, { value: "drop", label: "Drops" }]} />
      </div>

      {rows === null ? <Skeleton h={240} /> : groups.length === 0 ? (
        <div className="card"><Empty icon="bell" title="No alerts yet">You will see an entry here when a post suddenly jumps or drops.</Empty></div>
      ) : groups.map(([day, items]) => (
        <div key={day}>
          <div className="timeline-day">{day}</div>
          <div className="card flush">
            {items.map((r) => {
              const m = RE.exec(r.message);
              const pf = m?.[1] as "instagram" | "youtube" | "twitter" | undefined;
              return (
                <div className="alert-item" key={r.id + r.created_at}>
                  <span className={`alert-ico ${r.kind}`}><Icon name={r.kind === "spike" ? "trend" : "arrowdown"} size={17} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {m ? (
                      <>
                        <div style={{ fontWeight: 650 }}>
                          {m[3][0].toUpperCase() + m[3].slice(1)} {r.kind === "spike" ? "jumped" : "dropped"} <span className={r.kind === "spike" ? "up" : "down"}>{m[6]}%</span>
                        </div>
                        <div className="muted small">{m[4]} → {m[5]}{m[7] ? <> · <a href={m[7]} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>open post</a></> : null}</div>
                      </>
                    ) : <div>{r.message}</div>}
                  </div>
                  {pf && <PlatformMark platform={pf} size={24} />}
                  <span className="muted small" style={{ whiteSpace: "nowrap" }}>{ago(r.created_at)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
