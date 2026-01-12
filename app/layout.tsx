import "./globals.css";
import type { Metadata } from "next";
import Shell from "./Shell";
import ToastProvider from "@/components/ToastProvider";
import { ProjectsProvider } from "./context/ProjectsContext";

export const metadata: Metadata = {
  title: "ProMin",
  description: "Simple project milestones dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <ProjectsProvider>
            <Shell>
              {children}
            </Shell>
          </ProjectsProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
