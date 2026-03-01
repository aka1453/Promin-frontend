"use client";

import { useState, useRef, useCallback, type ReactNode } from "react";

type Placement = "top" | "bottom";

type Props = {
  content: ReactNode;
  children: ReactNode;
  placement?: Placement;
};

/**
 * Lightweight hover tooltip — dark background, white text.
 * Matches the Gantt chart tooltip style (bg-slate-800).
 *
 * Usage:
 *   <Tooltip content="50% of budget used">
 *     <div>...</div>
 *   </Tooltip>
 */
export default function Tooltip({ content, children, placement = "bottom" }: Props) {
  const [visible, setVisible] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback(() => {
    clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setVisible(true), 150);
  }, []);

  const hide = useCallback(() => {
    clearTimeout(timeout.current);
    setVisible(false);
  }, []);

  const placementClasses =
    placement === "top"
      ? "bottom-full left-1/2 -translate-x-1/2 mb-2"
      : "top-full left-1/2 -translate-x-1/2 mt-2";

  const arrowClasses =
    placement === "top"
      ? "top-full left-1/2 -translate-x-1/2 border-t-slate-800 border-x-transparent border-b-transparent border-4"
      : "bottom-full left-1/2 -translate-x-1/2 border-b-slate-800 border-x-transparent border-t-transparent border-4";

  return (
    <div className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && (
        <div
          className={`absolute z-[100] pointer-events-none ${placementClasses}`}
        >
          <div className="bg-slate-800 text-white text-xs leading-relaxed rounded-lg px-3 py-2 shadow-lg whitespace-nowrap">
            {content}
          </div>
          <div className={`absolute w-0 h-0 ${arrowClasses}`} />
        </div>
      )}
    </div>
  );
}
