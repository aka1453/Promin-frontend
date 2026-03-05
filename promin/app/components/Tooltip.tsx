"use client";

import { useState, useRef, useCallback, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Placement = "top" | "bottom";

type Props = {
  content: ReactNode;
  children: ReactNode;
  placement?: Placement;
};

/**
 * Lightweight hover tooltip — dark background, white text.
 * Renders via portal so it always floats above sidebars, modals, etc.
 */
export default function Tooltip({ content, children, placement = "bottom" }: Props) {
  const [visible, setVisible] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const show = useCallback(() => {
    clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setVisible(true), 150);
  }, []);

  const hide = useCallback(() => {
    clearTimeout(timeout.current);
    setVisible(false);
    setPositioned(false);
  }, []);

  // Position the tooltip after it renders (useLayoutEffect to avoid flicker)
  useLayoutEffect(() => {
    if (!visible || !triggerRef.current || !tooltipRef.current) return;

    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    const rect = trigger.getBoundingClientRect();
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;

    let x = rect.left + rect.width / 2 - tooltipWidth / 2;
    let y = placement === "top"
      ? rect.top - tooltipHeight - 8
      : rect.bottom + 8;

    // Clamp to viewport edges with padding
    const pad = 8;
    if (x < pad) x = pad;
    if (x + tooltipWidth > window.innerWidth - pad) x = window.innerWidth - tooltipWidth - pad;
    // If tooltip goes below viewport in "bottom" mode, flip to top
    if (placement === "bottom" && y + tooltipHeight > window.innerHeight - pad) {
      y = rect.top - tooltipHeight - 8;
    }
    if (y < pad) y = pad;

    setCoords({ x, y });
    setPositioned(true);
  }, [visible, placement, content]);

  return (
    <div className="relative inline-flex" ref={triggerRef} onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && createPortal(
        <div
          ref={tooltipRef}
          style={{
            position: "fixed",
            left: coords.x,
            top: coords.y,
            opacity: positioned ? 1 : 0,
            maxWidth: "min(360px, 90vw)",
          }}
          className="z-[9999] pointer-events-none"
        >
          <div className="bg-slate-800 text-white text-xs leading-relaxed rounded-lg px-3 py-2 shadow-lg">
            {content}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
