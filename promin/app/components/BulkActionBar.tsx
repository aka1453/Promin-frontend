"use client";

import { useState } from "react";

type Props = {
  count: number;
  onBatchComplete: () => Promise<void>;
  onClear: () => void;
};

export default function BulkActionBar({ count, onBatchComplete, onClear }: Props) {
  const [loading, setLoading] = useState(false);

  const handleComplete = async () => {
    setLoading(true);
    try {
      await onBatchComplete();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sticky bottom-0 z-30 bg-white border-t border-gray-200 shadow-lg px-6 py-3 flex items-center justify-between">
      <span className="text-sm font-medium text-gray-700">
        {count} selected
      </span>
      <div className="flex items-center gap-3">
        <button
          onClick={onClear}
          disabled={loading}
          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50"
        >
          Clear
        </button>
        <button
          onClick={handleComplete}
          disabled={loading}
          className="px-4 py-1.5 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? "Completing..." : "Mark all done"}
        </button>
      </div>
    </div>
  );
}
