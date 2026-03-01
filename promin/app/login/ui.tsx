"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

type Mode = "signin" | "signup";
type View = "main" | "forgot" | "new-password";

/* ───────── Password strength helpers ───────── */

type Strength = "weak" | "fair" | "good" | "strong";

function evaluateStrength(pw: string): { level: Strength; pct: number } {
  if (!pw) return { level: "weak", pct: 0 };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 1) return { level: "weak", pct: 20 };
  if (score === 2) return { level: "fair", pct: 45 };
  if (score === 3) return { level: "good", pct: 70 };
  return { level: "strong", pct: 100 };
}

const strengthColor: Record<Strength, string> = {
  weak: "bg-red-400",
  fair: "bg-amber-400",
  good: "bg-blue-400",
  strong: "bg-emerald-500",
};

const strengthLabel: Record<Strength, string> = {
  weak: "Weak",
  fair: "Fair",
  good: "Good",
  strong: "Strong",
};

/* ───────── Shared styles ───────── */

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2";

const cardClass =
  "w-[420px] rounded-2xl bg-white shadow-lg ring-1 ring-slate-900/5 p-8";

/* ───────── Parse hash fragments from URL ───────── */

function parseHash(hash: string): Record<string, string> {
  const params: Record<string, string> = {};
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return params;
  for (const pair of raw.split("&")) {
    const [key, ...rest] = pair.split("=");
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(rest.join("="));
  }
  return params;
}

/* ───────── Component ───────── */

export default function LoginUI() {
  const [mode, setMode] = useState<Mode>("signin");
  const [view, setView] = useState<View>("main");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [password, setPassword] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  // Forgot-password state
  const [resetSent, setResetSent] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetPending, setResetPending] = useState(false);

  // New-password state (after recovery link click)
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [updatePending, setUpdatePending] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [recoveryExpired, setRecoveryExpired] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const strength = useMemo(() => evaluateStrength(password), [password]);
  const newPwStrength = useMemo(() => evaluateStrength(newPw), [newPw]);
  const recoveryHandled = useRef(false);

  /* ── Detect recovery session on mount ──
   *
   * The Supabase client has detectSessionInUrl: false, so we must
   * manually handle recovery tokens. Detection triggers if ANY of:
   *   - URL hash contains type=recovery (implicit flow)
   *   - URL query has mode=recovery (our redirectTo marker)
   *   - URL query has code param (PKCE flow)
   */
  useEffect(() => {
    if (recoveryHandled.current) return;

    const hash = window.location.hash;
    const hashParams = parseHash(hash);
    const hasHashRecovery = hashParams.type === "recovery";
    const hasQueryRecovery = searchParams.get("mode") === "recovery";
    const code = searchParams.get("code");

    if (!hasHashRecovery && !hasQueryRecovery && !code) return;

    recoveryHandled.current = true;
    setRecoveryLoading(true);

    if (process.env.NODE_ENV === "development") {
      console.log("[recovery] detected via:", {
        hashRecovery: hasHashRecovery,
        queryRecovery: hasQueryRecovery,
        hasCode: !!code,
      });
    }

    async function establishRecoverySession() {
      // Strategy A: hash-based tokens (implicit flow)
      if (hashParams.access_token && hashParams.refresh_token) {
        if (process.env.NODE_ENV === "development") {
          console.log("[recovery] using hash token strategy");
        }
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: hashParams.access_token,
          refresh_token: hashParams.refresh_token,
        });

        // Clean URL
        window.history.replaceState(null, "", window.location.pathname);

        if (sessionError) {
          setRecoveryExpired(true);
          setView("new-password");
          setRecoveryLoading(false);
          return;
        }

        setView("new-password");
        setRecoveryLoading(false);
        return;
      }

      // Strategy B: code-based (PKCE flow)
      if (code) {
        if (process.env.NODE_ENV === "development") {
          console.log("[recovery] using PKCE code strategy");
        }
        const { error: codeError } =
          await supabase.auth.exchangeCodeForSession(code);

        // Clean URL
        window.history.replaceState(null, "", window.location.pathname);

        if (codeError) {
          setRecoveryExpired(true);
          setView("new-password");
          setRecoveryLoading(false);
          return;
        }

        setView("new-password");
        setRecoveryLoading(false);
        return;
      }

      // Strategy C: session may already be established (e.g. via middleware)
      if (process.env.NODE_ENV === "development") {
        console.log("[recovery] checking existing session");
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();

      // Clean URL
      window.history.replaceState(null, "", window.location.pathname);

      if (session) {
        setView("new-password");
        setRecoveryLoading(false);
        return;
      }

      // No valid recovery signal found
      setRecoveryExpired(true);
      setView("new-password");
      setRecoveryLoading(false);
    }

    establishRecoverySession();
  }, [searchParams]);

  /* ── Fallback: onAuthStateChange for PASSWORD_RECOVERY ── */
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setView("new-password");
        setError(null);
        setRecoveryExpired(false);
        setUpdateSuccess(false);
        setRecoveryLoading(false);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  /* ── Helper: go back to sign-in ── */
  const backToSignIn = useCallback(() => {
    setView("main");
    setError(null);
    setResetSent(false);
    setResetEmail("");
    setNewPw("");
    setConfirmPw("");
    setUpdateSuccess(false);
    setRecoveryExpired(false);
  }, []);

  /* ── Auth submit ── */
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(e.currentTarget);
    const email = form.get("email") as string;
    const pw = form.get("password") as string;

    try {
      if (mode === "signin") {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email,
          password: pw,
        });
        if (authError) {
          setError(authError.message);
          setPending(false);
          return;
        }
      } else {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password: pw,
        });
        if (signUpError) {
          setError(signUpError.message);
          setPending(false);
          return;
        }
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setPending(false);
    }
  }

  /* ── Google OAuth ── */
  async function handleGoogle() {
    setError(null);
    setPending(true);
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/` },
      });
      if (oauthError) {
        const msg = oauthError.message.toLowerCase();
        if (
          msg.includes("provider") ||
          msg.includes("not enabled") ||
          msg.includes("unsupported")
        ) {
          setError(
            "Google sign-in is not yet configured. Please use email and password."
          );
        } else {
          setError(oauthError.message);
        }
        setPending(false);
      }
    } catch {
      setError("Could not connect to Google. Please try again.");
      setPending(false);
    }
  }

  /* ── Request password reset email ── */
  async function handleResetRequest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!resetEmail) return;
    setError(null);
    setResetPending(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        resetEmail,
        { redirectTo: `${window.location.origin}/login?mode=recovery` }
      );
      if (resetError) {
        setError(resetError.message);
        setResetPending(false);
        return;
      }
      setResetSent(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setResetPending(false);
    }
  }

  /* ── Submit new password (recovery) ── */
  async function handleNewPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (newPw !== confirmPw) {
      setError("Passwords do not match.");
      return;
    }
    if (newPw.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setUpdatePending(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPw,
      });
      if (updateError) {
        const msg = updateError.message.toLowerCase();
        if (
          msg.includes("expired") ||
          msg.includes("invalid") ||
          msg.includes("session")
        ) {
          setRecoveryExpired(true);
        } else {
          setError(updateError.message);
        }
        setUpdatePending(false);
        return;
      }
      // Sign out so user can log in fresh with new password
      await supabase.auth.signOut();
      setUpdateSuccess(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setUpdatePending(false);
    }
  }

  /* ────────────────────────────────────────────
     Recovery loading state
     ──────────────────────────────────────────── */
  if (recoveryLoading) {
    return (
      <div className={cardClass}>
        <h1 className="text-2xl font-semibold text-center mb-0.5 text-slate-900">
          ProMin
        </h1>
        <p className="text-[13px] text-slate-400 text-center mb-6">
          Verifying recovery link...
        </p>
      </div>
    );
  }

  /* ────────────────────────────────────────────
     VIEW: Set new password (after recovery link)
     ──────────────────────────────────────────── */
  if (view === "new-password") {
    return (
      <div className={cardClass}>
        <h1 className="text-2xl font-semibold text-center mb-0.5 text-slate-900">
          ProMin
        </h1>
        <p className="text-[13px] text-slate-400 text-center mb-6">
          Set a new password
        </p>

        {updateSuccess ? (
          <div className="text-center space-y-4">
            <div className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              Password updated successfully. You can now sign in.
            </div>
            <button
              type="button"
              onClick={backToSignIn}
              className={`text-sm text-blue-600 hover:text-blue-700 ${focusRing} rounded`}
            >
              Go to sign in
            </button>
          </div>
        ) : recoveryExpired ? (
          <div className="text-center space-y-4">
            <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-700">
              This recovery link has expired or is invalid.
            </div>
            <button
              type="button"
              onClick={() => {
                setRecoveryExpired(false);
                setView("forgot");
                setError(null);
              }}
              className={`text-sm text-blue-600 hover:text-blue-700 ${focusRing} rounded`}
            >
              Request a new reset link
            </button>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">
                {error}
              </div>
            )}
            <form onSubmit={handleNewPassword} className="space-y-4">
              <div>
                <label className="text-xs text-slate-600">New password</label>
                <input
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  placeholder="New password"
                  autoComplete="new-password"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {newPw.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${strengthColor[newPwStrength.level]}`}
                        style={{ width: `${newPwStrength.pct}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-500">
                      {strengthLabel[newPwStrength.level]}
                      {newPw.length < 12 && (
                        <span className="ml-1 text-slate-400">
                          &middot; 12+ characters recommended
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-slate-600">
                  Confirm password
                </label>
                <input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="Confirm password"
                  autoComplete="new-password"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={updatePending}
                className={`w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition-colors ${focusRing}`}
              >
                {updatePending ? "Updating..." : "Update password"}
              </button>
            </form>
          </>
        )}
      </div>
    );
  }

  /* ────────────────────────────────────────────
     VIEW: Forgot password (request reset email)
     ──────────────────────────────────────────── */
  if (view === "forgot") {
    return (
      <div className={cardClass}>
        <h1 className="text-2xl font-semibold text-center mb-0.5 text-slate-900">
          ProMin
        </h1>
        <p className="text-[13px] text-slate-400 text-center mb-6">
          Reset your password
        </p>

        {resetSent ? (
          <div className="text-center space-y-4">
            <div className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              Check your email for a password reset link.
            </div>
            <button
              type="button"
              onClick={backToSignIn}
              className={`text-sm text-blue-600 hover:text-blue-700 ${focusRing} rounded`}
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">
                {error}
              </div>
            )}
            <form onSubmit={handleResetRequest} className="space-y-4">
              <div>
                <label className="text-xs text-slate-600">Email</label>
                <input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="Enter your email"
                  autoComplete="email"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={resetPending}
                className={`w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition-colors ${focusRing}`}
              >
                {resetPending ? "Sending..." : "Send reset link"}
              </button>
            </form>
            <button
              type="button"
              onClick={backToSignIn}
              className={`mt-4 block w-full text-center text-xs text-slate-400 hover:text-slate-600 transition-colors ${focusRing} rounded`}
            >
              Back to sign in
            </button>
          </>
        )}
      </div>
    );
  }

  /* ────────────────────────────────────────────
     VIEW: Main login / signup
     ──────────────────────────────────────────── */
  return (
    <div className={cardClass}>
      {/* Heading */}
      <h1 className="text-2xl font-semibold text-center mb-0.5 text-slate-900">
        ProMin
      </h1>
      <p className="text-[13px] text-slate-400 text-center mb-6">
        {mode === "signin"
          ? "Sign in to your workspace"
          : "Create your account"}
      </p>

      {/* Segmented control */}
      <div className="flex mb-6 rounded-lg bg-slate-100 p-1 text-sm">
        <button
          type="button"
          onClick={() => {
            setMode("signin");
            setError(null);
            setPassword("");
          }}
          className={`flex-1 py-2 rounded-md font-medium transition-all duration-200 ${focusRing} ${
            mode === "signin"
              ? "bg-white shadow-sm text-slate-900"
              : "text-slate-400 hover:text-slate-600"
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("signup");
            setError(null);
            setPassword("");
          }}
          className={`flex-1 py-2 rounded-md font-medium transition-all duration-200 ${focusRing} ${
            mode === "signup"
              ? "bg-white shadow-sm text-slate-900"
              : "text-slate-400 hover:text-slate-600"
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

      {/* Google OAuth */}
      <button
        type="button"
        onClick={handleGoogle}
        disabled={pending}
        className={`mb-4 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 transition-colors ${focusRing}`}
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        Continue with Google
      </button>

      {/* Divider */}
      <div className="relative mb-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-white px-3 text-slate-400">or</span>
        </div>
      </div>

      {/* Email/password form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs text-slate-600">Email</label>
          <input
            type="email"
            name="email"
            placeholder="Email"
            autoComplete="email"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="text-xs text-slate-600">Password</label>
          <input
            type="password"
            name="password"
            placeholder="Password"
            autoComplete={
              mode === "signin" ? "current-password" : "new-password"
            }
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {/* Forgot password link (sign-in only) */}
          {mode === "signin" && (
            <button
              type="button"
              onClick={() => {
                setView("forgot");
                setError(null);
              }}
              className={`mt-1.5 text-xs text-blue-600 hover:text-blue-700 transition-colors ${focusRing} rounded`}
            >
              Forgot password?
            </button>
          )}

          {/* Password strength indicator (sign-up only) */}
          {mode === "signup" && password.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${strengthColor[strength.level]}`}
                  style={{ width: `${strength.pct}%` }}
                />
              </div>
              <p className="text-xs text-slate-500">
                {strengthLabel[strength.level]}
                {password.length < 12 && (
                  <span className="ml-1 text-slate-400">
                    &middot; 12+ characters recommended
                  </span>
                )}
              </p>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={pending}
          className={`w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition-colors ${focusRing}`}
        >
          {pending
            ? mode === "signin"
              ? "Signing in..."
              : "Creating account..."
            : mode === "signin"
            ? "Sign in"
            : "Sign up"}
        </button>
      </form>

      {/* MFA note */}
      <p className="mt-5 text-center text-[11px] text-slate-400">
        Multi-factor authentication supported
      </p>
    </div>
  );
}
