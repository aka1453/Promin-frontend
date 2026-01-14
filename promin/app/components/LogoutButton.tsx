"use client";

import { supabase } from "../lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <button
      onClick={handleLogout}
      className="
        w-full
        mt-6
        bg-red-600
        hover:bg-red-700
        text-white
        font-semibold
        py-2
        rounded-lg
        text-sm
        shadow-sm
      "
    >
      Logout
    </button>
  );
}
