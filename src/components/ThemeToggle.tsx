import { Moon, Sun } from 'lucide-react';
import { useStore } from '../store';

export function ThemeToggle() {
  const { theme, dispatch } = useStore();
  const isDark = theme === 'dark';
  return (
    <button
      onClick={() => dispatch({ type: 'THEME_SET', theme: isDark ? 'light' : 'dark' })}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 bg-white text-ink-600 transition hover:bg-ink-50 hover:text-ink-900 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-ink-700 dark:hover:text-white"
      aria-label="Toggle theme"
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
