"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./components/Sidebar";

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showSidebar = !pathname.startsWith("/login");

  return (
    <div className="flex">
      {showSidebar && <Sidebar />}

      {/* MAIN CONTENT — OFFSET FOR FIXED SIDEBAR */}
      <main
        className={`min-h-screen bg-[var(--background)] ${
          showSidebar ? "ml-80" : ""
        }`}
      >
        {children}
      </main>
    </div>
  );
}
