"use client";

type Props = {
  mode: "browsing" | "creating";
};

export default function CommandFooter({ mode }: Props) {
  return (
    <div className="flex items-center gap-5 px-4 py-2.5 border-t border-[var(--card-border)] bg-gray-50/50 dark:bg-gray-900/50">
      {mode === "browsing" ? (
        <>
          <Hint keys="↑↓" label="Navigate" />
          <Hint keys="↵" label="Select" />
          <Hint keys="Esc" label="Close" />
        </>
      ) : (
        <>
          <Hint keys="↵" label="Create" />
          <Hint keys="Esc" label="Back" />
        </>
      )}
    </div>
  );
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
      <kbd className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
        {keys}
      </kbd>
      {label}
    </span>
  );
}
