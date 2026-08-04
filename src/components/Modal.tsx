import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  icon,
  scrollable = false,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | 'full';
  icon?: ReactNode;
  scrollable?: boolean;
  actions?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', '3xl': 'max-w-3xl', xl: 'max-w-4xl', '2xl': 'max-w-6xl', full: 'max-w-6xl' };

  return (
    <div className={`fixed inset-0 z-50 flex justify-center bg-ink-950/60 p-4 backdrop-blur-sm animate-fade-in ${scrollable ? 'items-center' : 'items-start overflow-y-auto sm:items-center'}`}>
      <div
        className={`relative w-full ${widths[size]} animate-scale-in rounded-2xl border border-ink-200 bg-white shadow-elev-4 dark:border-ink-800 dark:bg-ink-900 ${scrollable ? 'flex max-h-[85vh] flex-col' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-start justify-between gap-4 border-b border-ink-200/70 px-6 py-5 dark:border-ink-800 ${scrollable ? 'shrink-0' : ''}`}>
          <div className="flex items-start gap-3">
            {icon && <div className="mt-0.5 text-primary-600 dark:text-primary-400">{icon}</div>}
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-ink-900 dark:text-white">{title}</h2>
              {subtitle && <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">{subtitle}</p>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            <button onClick={onClose} className="btn-ghost shrink-0 rounded-lg p-1.5" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className={`px-6 py-5 ${scrollable ? 'min-h-0 flex-1 overflow-y-auto' : ''}`}>{children}</div>
        {footer && (
          <div className={`flex items-center justify-end gap-3 border-t border-ink-200/70 bg-ink-50/60 px-6 py-4 dark:border-ink-800 dark:bg-ink-950/40 ${scrollable ? 'shrink-0' : ''}`}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
