export function ProgressBar({
  value,
  max = 100,
  tone = 'primary',
  size = 'md',
  showLabel = false,
  indeterminate = false,
}: {
  value: number;
  max?: number;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'accent';
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  indeterminate?: boolean;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const tones = {
    primary: 'bg-primary-500',
    success: 'bg-success-500',
    warning: 'bg-warning-500',
    danger: 'bg-danger-500',
    accent: 'bg-accent-500',
  };
  const sizes = { sm: 'h-1.5', md: 'h-2', lg: 'h-3' };
  return (
    <div className="w-full">
      <div className={`relative w-full overflow-hidden rounded-full bg-ink-200/70 dark:bg-ink-800 ${sizes[size]}`}>
        {indeterminate ? (
          <div className={`absolute inset-y-0 left-0 w-1/3 animate-progress-indeterminate rounded-full ${tones[tone]}`} />
        ) : (
          <div
            className={`h-full rounded-full ${tones[tone]} transition-[width] duration-500 ease-out`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      {showLabel && (
        <div className="mt-1 text-right text-xs font-medium text-ink-500 dark:text-ink-400">{pct.toFixed(0)}%</div>
      )}
    </div>
  );
}
