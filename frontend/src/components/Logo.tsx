export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2" aria-label="PageTurn">
      <svg
        aria-hidden="true"
        className="h-8 w-8 shrink-0"
        fill="none"
        viewBox="0 0 32 32"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect fill="var(--color-accent)" height="32" rx="8" width="32" />
        <path
          d="M9 9.75c2.4.08 4.45.58 6.1 1.7.56.38.9 1.01.9 1.69v9.36c-1.75-1.28-4.05-1.92-7-1.98V9.75Z"
          stroke="var(--color-bg)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        <path
          d="M23 9.75c-2.4.08-4.45.58-6.1 1.7a2.03 2.03 0 0 0-.9 1.69v9.36c1.75-1.28 4.05-1.92 7-1.98V9.75Z"
          stroke="var(--color-bg)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        <path
          d="M12 14.25h1.5M18.5 14.25H20M12 17.25h1.5M18.5 17.25H20"
          stroke="var(--color-bg)"
          strokeLinecap="round"
          strokeWidth="1.4"
        />
      </svg>
      {!compact && (
        <span className="text-[22px] font-semibold tracking-normal text-text-primary">
          PageTurn
        </span>
      )}
    </div>
  );
}
