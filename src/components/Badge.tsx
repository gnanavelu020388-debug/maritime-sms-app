import type { ReactNode } from 'react';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent';

const TONES: Record<Tone, string> = {
  success: 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300',
  warning: 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300',
  danger: 'bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-300',
  info: 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
  accent: 'bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300',
  neutral: 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
};

const DOTS: Record<Tone, string> = {
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  info: 'bg-primary-500',
  accent: 'bg-accent-500',
  neutral: 'bg-ink-400',
};

export function Badge({
  tone = 'neutral',
  children,
  dot = false,
  pulse = false,
  className = '',
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={`badge ${TONES[tone]} ${className}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${DOTS[tone]} ${pulse ? 'animate-pulse-soft' : ''}`} />}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: Tone; label: string }> = {
    active: { tone: 'success', label: 'Active' },
    suspended: { tone: 'danger', label: 'Suspended' },
    trial: { tone: 'warning', label: 'Trial' },
    provisioning: { tone: 'info', label: 'Provisioning' },
    archived: { tone: 'neutral', label: 'Archived' },
    paid: { tone: 'success', label: 'Paid' },
    overdue: { tone: 'danger', label: 'Overdue' },
    processing: { tone: 'warning', label: 'Processing' },
    draft: { tone: 'neutral', label: 'Draft' },
    syncing: { tone: 'info', label: 'Syncing' },
    queued: { tone: 'warning', label: 'Queued' },
    processed: { tone: 'success', label: 'Processed' },
    failed: { tone: 'danger', label: 'Failed' },
    completed: { tone: 'success', label: 'Completed' },
    running: { tone: 'info', label: 'Running' },
    expired: { tone: 'neutral', label: 'Expired' },
    locked: { tone: 'danger', label: 'Locked' },
    invited: { tone: 'warning', label: 'Invited' },
  };
  const cfg = map[status] ?? { tone: 'neutral' as Tone, label: status };
  return (
    <Badge tone={cfg.tone} dot pulse={cfg.tone === 'info' || cfg.tone === 'warning'}>
      {cfg.label}
    </Badge>
  );
}
