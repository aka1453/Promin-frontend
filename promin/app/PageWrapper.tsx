"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./components/Sidebar";

export default function PageWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideSidebar = pathname.startsWith("/login");

  return (
    <div className="flex">
      {!hideSidebar && <Sidebar />}

      <main className={hideSidebar ? "w-full" : "flex-1 p-8"}>
        {children}
      </main>
    </div>
  );
}
