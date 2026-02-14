"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/signout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="w-full px-4 py-3 rounded-lg text-gray-700 font-medium text-base hover:bg-gray-100 transition"
    >
      Log Out
    </button>
  );
}
