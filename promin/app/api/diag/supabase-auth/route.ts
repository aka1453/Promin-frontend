import { NextResponse } from "next/server";

const PICK_HEADERS = [
  "location",
  "server",
  "cf-ray",
  "x-request-id",
  "content-type",
] as const;

function pickHeaders(h: Headers) {
  const out: Record<string, string | null> = {};
  for (const k of PICK_HEADERS) out[k] = h.get(k);
  return out;
}

export async function GET() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const endpoint = `${url}/auth/v1/token?grant_type=password`;

  const results: Record<string, unknown> = { supabaseUrl: url, endpoint };

  // --- OPTIONS preflight ---
  try {
    const optRes = await fetch(endpoint, {
      method: "OPTIONS",
      redirect: "manual",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,apikey,authorization",
      },
    });
    results.options = {
      status: optRes.status,
      type: optRes.type,
      headers: pickHeaders(optRes.headers),
    };
  } catch (e: unknown) {
    results.options = { error: String(e) };
  }

  // --- POST with dummy body ---
  try {
    const postRes = await fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      },
      body: JSON.stringify({ email: "x", password: "y" }),
    });

    let body: string | null = null;
    try {
      body = await postRes.text();
      if (body.length > 500) body = body.slice(0, 500) + "…";
    } catch { /* ignore */ }

    results.post = {
      status: postRes.status,
      type: postRes.type,
      headers: pickHeaders(postRes.headers),
      body,
    };
  } catch (e: unknown) {
    results.post = { error: String(e) };
  }

  return NextResponse.json(results, {
    headers: { "Cache-Control": "no-store" },
  });
}
