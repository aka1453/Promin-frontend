"use client";

import { useState } from "react";

export default function DiagPage() {
  const [serverJson, setServerJson] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function runServer() {
    setLoading(true);
    try {
      const res = await fetch("/api/diag/supabase-auth");
      const data = await res.json();
      setServerJson(JSON.stringify(data, null, 2));
    } catch (e) {
      setServerJson(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "monospace", maxWidth: 900 }}>
      <h1>Supabase Auth Diagnostics (server-side only)</h1>
      <button onClick={runServer} disabled={loading} style={{ padding: "8px 16px", marginBottom: 16 }}>
        {loading ? "Running…" : "Run server-side test"}
      </button>
      {serverJson && (
        <pre style={{ background: "#111", color: "#0f0", padding: 16, borderRadius: 8, overflow: "auto" }}>{serverJson}</pre>
      )}
    </div>
  );
}
