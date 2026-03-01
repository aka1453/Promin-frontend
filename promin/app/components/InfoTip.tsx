"use client";

import { useState, useRef, useEffect } from "react";
import { Info } from "lucide-react";

interface InfoTipProps {
  tip: string;
}

export default function InfoTip({ tip }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative inline-flex" ref={ref}>
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setOpen(!open); } }}
        className="p-1 rounded-full text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer inline-flex items-center"
        aria-label="Info"
      >
        <Info size={16} />
      </span>
      {open && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-64 bg-slate-800 text-white rounded-lg shadow-lg p-3 text-sm leading-relaxed">
          <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-800 rotate-45" />
          {tip}
        </div>
      )}
    </div>
  );
}
