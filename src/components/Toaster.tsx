import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { useStore } from '../store';

const ICONS = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
};

const TONES = {
  success: 'border-success-200 bg-success-50 text-success-800 dark:border-success-900/60 dark:bg-success-900/30 dark:text-success-200',
  warning: 'border-warning-200 bg-warning-50 text-warning-800 dark:border-warning-900/60 dark:bg-warning-900/30 dark:text-warning-200',
  danger: 'border-danger-200 bg-danger-50 text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200',
  info: 'border-primary-200 bg-primary-50 text-primary-800 dark:border-primary-900/60 dark:bg-primary-900/30 dark:text-primary-200',
};

const ICON_TONES = {
  success: 'text-success-600 dark:text-success-400',
  warning: 'text-warning-600 dark:text-warning-400',
  danger: 'text-danger-600 dark:text-danger-400',
  info: 'text-primary-600 dark:text-primary-400',
};

export function Toaster() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICONS[t.tone];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-elev-3 animate-slide-up ${TONES[t.tone]}`}
          >
            <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${ICON_TONES[t.tone]}`} />
            <div className="flex-1">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.message && <p className="mt-0.5 text-xs opacity-80">{t.message}</p>}
            </div>
            <button onClick={() => dismissToast(t.id)} className="opacity-60 hover:opacity-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
