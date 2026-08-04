import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

export function Card({
  title,
  subtitle,
  icon,
  actions,
  children,
  className = '',
  bodyClassName = '',
  collapsible = false,
}: {
  title?: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-header">
          <div className="flex items-center gap-3">
            {icon && <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">{icon}</div>}
            <div>
              {title && <h3 className="text-sm font-bold text-ink-900 dark:text-white">{title}</h3>}
              {subtitle && <p className="text-xs text-ink-500 dark:text-ink-400">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {actions}
            {collapsible && (
              <button onClick={() => setOpen((o) => !o)} className="btn-ghost rounded-lg p-1.5">
                <ChevronDown className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
              </button>
            )}
          </div>
        </header>
      )}
      {open && <div className={`p-5 ${bodyClassName}`}>{children}</div>}
    </section>
  );
}
