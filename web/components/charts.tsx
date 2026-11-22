"use client";
import { ReactNode } from "react";

/** Tooltip card shared by all charts. `rows` are label/value/color triples. */
export function TipCard({ title, rows }: { title: string; rows: { label: ReactNode; value: ReactNode; color?: string }[] }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 12px", boxShadow: "var(--shadow-lg)", minWidth: 150 }}>
      <div className="muted small" style={{ marginBottom: 6 }}>{title}</div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "1px 0" }}>
          {r.color && <i style={{ width: 8, height: 8, borderRadius: 3, background: r.color, display: "inline-block" }} />}
          <span className="muted" style={{ flex: 1 }}>{r.label}</span>
          <b>{r.value}</b>
        </div>
      ))}
    </div>
  );
}

export const AXIS = { fontSize: 11, fill: "var(--faint)" } as const;
export const GRID = { stroke: "var(--border)", strokeDasharray: "3 4" } as const;
