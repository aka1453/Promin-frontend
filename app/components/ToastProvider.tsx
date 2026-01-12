"use client";

import React, { createContext, useContext, useMemo, useState } from "react";

type ToastVariant = "info" | "success" | "warning" | "error";

type Toast = {
  id: number;
  message: string;
  variant: ToastVariant;
};

type ToastContextType = {
  pushToast: (message: string, variant?: ToastVariant) => void;
};

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider />");
  }
  return ctx;
}

export default function ToastProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = (message: string, variant: ToastVariant = "info") => {
    const id = Date.now() + Math.floor(Math.random() * 1000);

    setToasts((prev) => [...prev, { id, message, variant }]);

    // Auto-dismiss
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2600);
  };

  const value = useMemo(() => ({ pushToast }), []);

  const variantClass = (v: ToastVariant) => {
    switch (v) {
      case "success":
        return "bg-emerald-600 text-white";
      case "warning":
        return "bg-amber-500 text-white";
      case "error":
        return "bg-rose-600 text-white";
      case "info":
      default:
        return "bg-slate-800 text-white";
    }
  };

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* TOAST STACK */}
      <div className="fixed top-4 right-4 z-[9999] space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-md px-4 py-2 text-sm font-medium shadow-lg transition-all ${variantClass(
              t.variant
            )}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
