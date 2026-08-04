import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  className?: string;
  width?: string;
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  pageSize = 8,
  searchable = true,
  searchPlaceholder = 'Search…',
  searchFn,
  emptyMessage = 'No records found.',
  toolbar,
  rowClassName,
  compact = false,
  fullWidth = false,
}: {
  columns: Column<T>[];
  rows: T[];
  pageSize?: number;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchFn?: (row: T, q: string) => boolean;
  emptyMessage?: string;
  toolbar?: ReactNode;
  rowClassName?: (row: T) => string;
  compact?: boolean;
  fullWidth?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!query) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => (searchFn ? searchFn(r, q) : JSON.stringify(r).toLowerCase().includes(q)));
  }, [rows, query, searchFn]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filtered, sort, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageRows = sorted.slice(page * pageSize, page * pageSize + pageSize);

  const toggleSort = (key: string) => {
    setPage(0);
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: 'asc' };
      if (s.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  };

  const cellPad = compact ? 'px-3 py-1.5' : 'px-4 py-3';
  const headPad = compact ? 'px-3 py-2' : 'px-4 py-3';

  return (
    <div>
      {searchable || toolbar ? (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {searchable ? (
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(0); }}
                placeholder={searchPlaceholder}
                className="input pl-9"
              />
            </div>
          ) : <div />}
          {toolbar && <div className="flex items-center gap-2">{toolbar}</div>}
        </div>
      ) : null}

      <div className={fullWidth ? 'w-full' : 'overflow-x-auto rounded-xl border border-ink-200/70 dark:border-ink-800'}>
        <table className="w-full table-fixed text-left text-sm">
          <thead className="bg-ink-50/80 text-xs uppercase tracking-wide text-ink-500 dark:bg-ink-950/50 dark:text-ink-400">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`${headPad} font-semibold ${c.width ?? ''}`}>
                  {c.sortValue ? (
                    <button onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-ink-800 dark:hover:text-ink-200">
                      {c.header}
                      {sort?.key === c.key ? (
                        sort.dir === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
                      )}
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className={`${cellPad} text-center text-ink-400 py-10`}>{emptyMessage}</td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr
                  key={row.id}
                  className={`bg-white transition-colors hover:bg-primary-50/40 dark:bg-ink-900 dark:hover:bg-ink-800/50 ${rowClassName?.(row) ?? ''}`}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={`${cellPad} align-middle text-ink-700 dark:text-ink-200 ${c.className ?? ''}`}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {sorted.length > pageSize && (
        <div className="mt-3 flex items-center justify-between text-xs text-ink-500 dark:text-ink-400">
          <span>
            Showing <span className="font-semibold text-ink-700 dark:text-ink-200">{page * pageSize + 1}</span>–
            <span className="font-semibold text-ink-700 dark:text-ink-200">{Math.min(sorted.length, page * pageSize + pageSize)}</span> of{' '}
            <span className="font-semibold text-ink-700 dark:text-ink-200">{sorted.length}</span>
          </span>
          <div className="flex items-center gap-1">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="btn-ghost rounded-md p-1.5 disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2 font-medium">{page + 1} / {totalPages}</span>
            <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className="btn-ghost rounded-md p-1.5 disabled:opacity-40">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
