"use client";

import { createContext, useContext, useState, ReactNode } from "react";

type Toast = {
  id: number;
  message: string;
  variant?: "info" | "success" | "warning";
};

type ToastContextType = {
  pushToast: (message: string, variant?: Toast["variant"]) => void;
};

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = (
    message: string,
    variant: Toast["variant"] = "info"
  ) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, variant }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2200);
  };

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}

      {/* TOAST STACK */}
      <div className="fixed top-4 right-4 z-[9999] space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-md px-4 py-2 text-sm font-medium shadow-lg transition-all
              ${
                t.variant === "success"
                  ? "bg-emerald-600 text-white"
                  : t.variant === "warning"
                  ? "bg-amber-500 text-white"
                  : "bg-slate-800 text-white"
              }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return ctx;
}
