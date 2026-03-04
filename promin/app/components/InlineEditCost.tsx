"use client";

import { useState, useRef, useEffect } from "react";

type Props = {
  value: number | null;
  budgetedCost: number | null;
  readOnly: boolean;
  onSave: (newValue: number) => Promise<void>;
};

export default function InlineEditCost({ value, budgetedCost, readOnly, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [tempValue, setTempValue] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEdit = () => {
    if (readOnly) return;
    setTempValue(value && value > 0 ? String(value) : "");
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setTempValue("");
  };

  const save = async () => {
    if (saving) return;
    const numVal = parseFloat(tempValue) || 0;
    if (numVal < 0) { cancel(); return; }

    setSaving(true);
    try {
      await onSave(numVal);
      setEditing(false);
    } catch {
      // onSave caller handles error toast
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
    if (e.key === "Escape") { cancel(); }
  };

  const isOverBudget = (value ?? 0) > (budgetedCost ?? 0) && (budgetedCost ?? 0) > 0;
  const hasValue = value != null && value > 0;

  // --- Editing mode ---
  if (editing) {
    return (
      <span className="inline-flex items-center">
        <span className="text-gray-500 mr-1">$</span>
        <input
          ref={inputRef}
          type="number"
          step="0.01"
          min="0"
          value={tempValue}
          onChange={(e) => setTempValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={save}
          disabled={saving}
          className="w-24 border border-blue-400 rounded px-1.5 py-0.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          placeholder="0.00"
        />
        {saving && <span className="ml-1 text-xs text-gray-400">...</span>}
      </span>
    );
  }

  // --- Display mode ---
  // If readOnly and no value, show nothing
  if (readOnly && !hasValue) return null;

  // If editable and no value, show placeholder
  if (!hasValue) {
    return (
      <span
        onClick={startEdit}
        className="ml-2 font-medium text-gray-400 cursor-pointer hover:text-blue-600 hover:underline decoration-dashed underline-offset-2 transition-colors"
      >
        $ --
      </span>
    );
  }

  // Has value - show it, clickable if editable
  return (
    <span
      onClick={readOnly ? undefined : startEdit}
      className={`ml-2 font-medium ${isOverBudget ? "text-red-600" : "text-gray-900"} ${
        !readOnly ? "cursor-pointer hover:bg-blue-50 hover:rounded px-1 -mx-1 transition-colors" : ""
      }`}
    >
      ${value!.toLocaleString()}
    </span>
  );
}
