export function Toggle({
  checked,
  onChange,
  label,
  size = 'md',
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}) {
  const dims = size === 'sm' ? { w: 'w-9', h: 'h-5', knob: 'h-4 w-4', translate: 'translate-x-4' } : { w: 'w-11', h: 'h-6', knob: 'h-5 w-5', translate: 'translate-x-5' };
  return (
    <label className={`inline-flex items-center gap-2.5 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex ${dims.w} ${dims.h} shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500/30 ${
          checked ? 'bg-primary-600' : 'bg-ink-300 dark:bg-ink-700'
        }`}
      >
        <span className={`inline-block ${dims.knob} transform rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? dims.translate : 'translate-x-0.5'}`} />
      </button>
      {label && <span className="text-sm font-medium text-ink-700 dark:text-ink-200">{label}</span>}
    </label>
  );
}
