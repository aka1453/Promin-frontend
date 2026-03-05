"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

interface InfoTipProps {
  tip: string;
}

export default function InfoTip({ tip }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        ref.current && !ref.current.contains(e.target as Node) &&
        tipRef.current && !tipRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setPositioned(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Position the tip popover after it renders
  useLayoutEffect(() => {
    if (!open || !ref.current || !tipRef.current) return;

    const trigger = ref.current;
    const tip = tipRef.current;
    const rect = trigger.getBoundingClientRect();
    const tipWidth = tip.offsetWidth;
    const tipHeight = tip.offsetHeight;

    let x = rect.left + rect.width / 2 - tipWidth / 2;
    let y = rect.bottom + 8;

    // Clamp to viewport edges
    const pad = 8;
    if (x < pad) x = pad;
    if (x + tipWidth > window.innerWidth - pad) x = window.innerWidth - tipWidth - pad;
    if (y + tipHeight > window.innerHeight - pad) {
      y = rect.top - tipHeight - 8;
    }
    if (y < pad) y = pad;

    setCoords({ x, y });
    setPositioned(true);
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
      {open && createPortal(
        <div
          ref={tipRef}
          style={{
            position: "fixed",
            left: coords.x,
            top: coords.y,
            opacity: positioned ? 1 : 0,
          }}
          className="z-[9999] w-64 bg-slate-800 text-white rounded-lg shadow-lg p-3 text-sm leading-relaxed"
        >
          {tip}
        </div>,
        document.body
      )}
    </div>
  );
}
