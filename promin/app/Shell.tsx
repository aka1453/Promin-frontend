"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./components/Sidebar";
import CommandPalette from "./components/command-palette/CommandPalette";

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showSidebar = !pathname.startsWith("/login");

  return (
    <div className="flex min-h-screen">
      {showSidebar && <Sidebar />}

      {/* MAIN CONTENT — FLEX TO FILL REMAINING SPACE */}
      <main
        className={`flex-1 min-h-screen bg-[var(--background)] ${
          showSidebar ? "ml-64" : ""
        }`}
      >
        {children}
      </main>

      {showSidebar && <CommandPalette />}
    </div>
  );
}