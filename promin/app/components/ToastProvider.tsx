"use client";

import React, { createContext, useContext, useCallback, useState } from "react";

type ToastVariant = "info" | "success" | "warning" | "error";

type Toast = {
  id: number;
  message: string;
  variant: ToastVariant;
};

type ActionToast = {
  id: number;
  message: string;
  actionLabel: string;
  onAction: () => void;
  variant: ToastVariant;
};

type ToastContextType = {
  pushToast: (message: string, variant?: ToastVariant) => void;
  pushActionToast: (
    message: string,
    actionLabel: string,
    onAction: () => void,
    variant?: ToastVariant,
    dismissMs?: number
  ) => void;
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
  const [actionToasts, setActionToasts] = useState<ActionToast[]>([]);

  const pushToast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = Date.now() + Math.floor(Math.random() * 1000);

    setToasts((prev) => [...prev, { id, message, variant }]);

    // Auto-dismiss
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2600);
  }, []);

  const pushActionToast = useCallback((
    message: string,
    actionLabel: string,
    onAction: () => void,
    variant: ToastVariant = "info",
    dismissMs: number = 8000
  ) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);

    setActionToasts((prev) => [...prev, { id, message, actionLabel, onAction, variant }]);

    // Auto-dismiss
    setTimeout(() => {
      setActionToasts((prev) => prev.filter((t) => t.id !== id));
    }, dismissMs);
  }, []);

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
    <ToastContext.Provider value={{ pushToast, pushActionToast }}>
      {children}

      {/* TOAST STACK - top right */}
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

      {/* ACTION TOAST STACK - bottom center */}
      {actionToasts.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] space-y-2">
          {actionToasts.map((t) => (
            <div
              key={t.id}
              className="rounded-lg px-5 py-3 shadow-xl bg-slate-800 text-white flex items-center gap-4"
              style={{ animation: "slideUp 0.25s ease-out" }}
            >
              <span className="text-sm font-medium">{t.message}</span>
              <button
                onClick={() => {
                  t.onAction();
                  setActionToasts((prev) => prev.filter((at) => at.id !== t.id));
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-blue-500 hover:bg-blue-600 text-white whitespace-nowrap"
              >
                {t.actionLabel}
              </button>
              <button
                onClick={() => setActionToasts((prev) => prev.filter((at) => at.id !== t.id))}
                className="text-white/60 hover:text-white text-lg leading-none ml-1"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
