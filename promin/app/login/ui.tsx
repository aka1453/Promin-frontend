"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

type Mode = "signin" | "signup";

export default function LoginUI() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === "signup") {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });
        if (signUpError) throw signUpError;

        const { error: loginError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (loginError) throw loginError;
      } else {
        const { error: loginError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (loginError) throw loginError;
      }

      // After successful login, go to main dashboard
      router.push("/");
    } catch (err: any) {
      setError(err.message || "Unexpected error. Try again.");
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="w-[420px] rounded-2xl bg-white shadow-xl p-8">
      <h1 className="text-2xl font-semibold text-center mb-1">
        ProMin {mode === "signin" ? "Login" : "Create Account"}
      </h1>

      <p className="text-xs text-slate-500 text-center mb-6">
        Manage your projects, milestones, tasks and files.
      </p>

      <div className="flex mb-6 rounded-lg bg-slate-100 p-1 text-xs">
        <button
          onClick={() => setMode("signin")}
          className={`flex-1 py-2 rounded-md ${
            mode === "signin" ? "bg-white shadow text-slate-900" : "text-slate-500"
          }`}
        >
          Sign in
        </button>

        <button
          onClick={() => setMode("signup")}
          className={`flex-1 py-2 rounded-md ${
            mode === "signup" ? "bg-white shadow text-slate-900" : "text-slate-500"
          }`}
        >
          Sign up
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs text-slate-600">Email</label>
          <input
            type="email"
            value={email}
            placeholder="Email"
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="text-xs text-slate-600">Password</label>
          <input
            type="password"
            value={password}
            placeholder="Password"
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {loading
            ? mode === "signin"
              ? "Signing in..."
              : "Creating account..."
            : mode === "signin"
            ? "Sign in"
            : "Sign up"}
        </button>
      </form>
    </div>
  );
}
