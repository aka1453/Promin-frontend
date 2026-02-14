"use server";

import { redirect } from "next/navigation";
import { createSupabaseServer } from "../lib/supabaseServer";

export type AuthResult = { error: string | null };

export async function signIn(
  _prev: AuthResult,
  formData: FormData
): Promise<AuthResult> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  redirect("/");
}

export async function signUp(
  _prev: AuthResult,
  formData: FormData
): Promise<AuthResult> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createSupabaseServer();

  const { error: signUpError } = await supabase.auth.signUp({ email, password });
  if (signUpError) {
    return { error: signUpError.message };
  }

  // Auto-sign-in after signup
  const { error: loginError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (loginError) {
    return { error: loginError.message };
  }

  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
