"use client";

type StatusFilter = "pending" | "completed" | "all";
type TimeFilter = "all" | "overdue" | "today" | "week";

type Props = {
  status: StatusFilter;
  time: TimeFilter;
  onStatusChange: (s: StatusFilter) => void;
  onTimeChange: (t: TimeFilter) => void;
  counts: { pending: number; completed: number; total: number };
};

export default function MyWorkFilters({
  status,
  time,
  onStatusChange,
  onTimeChange,
  counts,
}: Props) {
  const pillClass = (active: boolean) =>
    `px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${
      active
        ? "bg-blue-600 text-white"
        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
    }`;

  return (
    <div className="flex flex-wrap items-center gap-4">
      {/* Status filters */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onStatusChange("pending")}
          className={pillClass(status === "pending")}
        >
          Pending ({counts.pending})
        </button>
        <button
          onClick={() => onStatusChange("completed")}
          className={pillClass(status === "completed")}
        >
          Completed ({counts.completed})
        </button>
        <button
          onClick={() => onStatusChange("all")}
          className={pillClass(status === "all")}
        >
          All ({counts.total})
        </button>
      </div>

      {/* Divider */}
      <div className="h-5 w-px bg-slate-200" />

      {/* Time filters */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onTimeChange("all")}
          className={pillClass(time === "all")}
        >
          All dates
        </button>
        <button
          onClick={() => onTimeChange("overdue")}
          className={pillClass(time === "overdue")}
        >
          Overdue
        </button>
        <button
          onClick={() => onTimeChange("today")}
          className={pillClass(time === "today")}
        >
          Today
        </button>
        <button
          onClick={() => onTimeChange("week")}
          className={pillClass(time === "week")}
        >
          This week
        </button>
      </div>
    </div>
  );
}
