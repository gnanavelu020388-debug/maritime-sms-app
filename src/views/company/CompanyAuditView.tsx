import { useEffect, useState } from 'react';
import { Shield, Download, FileText, Filter, Eye, EyeOff } from 'lucide-react';
import { supabase, type AuditLogRow } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { isDemoMode, getDemoAuditLogs } from '../../lib/demoData';
import { Badge } from '../../components/Badge';

export function CompanyAuditView() {
  const { tenant, tenantUser } = useAuth();
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCat, setFilterCat] = useState('all');
  const [cleanRoom, setCleanRoom] = useState(false);
  const [search, setSearch] = useState('');

  async function load() {
    if (!tenant) return;
    setLoading(true);
    if (isDemoMode()) {
      let logs = [...getDemoAuditLogs(tenant.id)].sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (filterCat !== 'all') logs = logs.filter((l) => l.category === filterCat);
      setLogs(logs);
      setLoading(false);
      return;
    }
    let q = supabase.from('audit_logs').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(500);
    if (filterCat !== 'all') q = q.eq('category', filterCat);
    const { data } = await q;
    setLogs((data as AuditLogRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [tenant, filterCat]);

  const filtered = logs.filter((l) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return l.action.toLowerCase().includes(s) || l.actor_email.toLowerCase().includes(s) || (l.target ?? '').toLowerCase().includes(s);
  });

  function exportCSV() {
    const rows = [['Timestamp (UTC)', 'Actor', 'Category', 'Action', 'Target', 'IP', 'Location', 'Severity']];
    filtered.forEach((l) => rows.push([new Date(l.created_at).toISOString(), l.actor_email, l.category, l.action, l.target ?? '', l.ip_address ?? '', l.location ?? '', l.severity]));
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  function exportPDF() {
    // Browser-native print-to-PDF via a clean window
    const w = window.open('', '_blank');
    if (!w) return;
    const rows = filtered.map((l) => `<tr><td>${new Date(l.created_at).toISOString()}</td><td>${l.actor_email}</td><td>${l.category}</td><td>${l.action}</td><td>${l.target ?? ''}</td><td>${l.location ?? ''}</td><td>${l.severity}</td></tr>`).join('');
    w.document.write(`<html><head><title>Audit Log — ${tenant?.company}</title><style>body{font-family:sans-serif;margin:40px}h1{font-size:18px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #ddd;padding:6px;text-align:left}th{background:#f5f5f5}</style></head><body><h1>Compliance Audit Ledger — ${tenant?.company}</h1><p>Exported ${new Date().toISOString()} by ${tenantUser?.email}</p><table><thead><tr><th>UTC Timestamp</th><th>Actor</th><th>Category</th><th>Action</th><th>Target</th><th>Location</th><th>Severity</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
    w.document.close();
    w.print();
  }

  const categories = ['all', 'auth', 'tenant', 'sms', 'billing', 'security', 'system', 'crew'];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-900 dark:text-white">Audit Trail & Compliance Ledger</h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">Immutable append-only record — {logs.length} events</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCSV} className="btn-secondary"><Download className="h-4 w-4" /> CSV</button>
          <button onClick={exportPDF} className="btn-secondary"><FileText className="h-4 w-4" /> PDF</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-200/70 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-500"><Filter className="h-3.5 w-3.5" /> Filter:</div>
        {categories.map((c) => (
          <button key={c} onClick={() => setFilterCat(c)} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${filterCat === c ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300' : 'text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800'}`}>
            {c === 'all' ? 'All' : c}
          </button>
        ))}
        <input className="input ml-auto !py-1 !text-xs w-48" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button onClick={() => setCleanRoom((v) => !v)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${cleanRoom ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300' : 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300'}`}>
          {cleanRoom ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          Clean Room {cleanRoom ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className={`overflow-hidden rounded-xl border border-ink-200/70 dark:border-ink-800 ${cleanRoom ? 'bg-white dark:bg-ink-900' : ''}`}>
        {cleanRoom ? (
          <div className="p-6">
            <p className="mb-4 text-sm font-bold text-ink-900 dark:text-white">Chronological Compliance Timeline</p>
            <div className="space-y-3">
              {filtered.map((l) => (
                <div key={l.id} className="flex gap-3 border-l-2 border-primary-200 pl-4 dark:border-primary-800">
                  <div>
                    <p className="text-sm font-semibold text-ink-900 dark:text-white">{l.action}</p>
                    <p className="text-xs text-ink-400">
                      {new Date(l.created_at).toLocaleString()} · {l.actor_email} · {l.location}
                      {l.target ? ` · ${l.target}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-50 text-xs uppercase text-ink-500 dark:bg-ink-950/50">
                <tr>
                  <th className="px-4 py-3 font-semibold">UTC Timestamp</th>
                  <th className="px-4 py-3 font-semibold">Actor</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                  <th className="px-4 py-3 font-semibold">Target</th>
                  <th className="px-4 py-3 font-semibold">Location</th>
                  <th className="px-4 py-3 font-semibold">Severity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {loading ? (
                  <tr><td colSpan={7} className="py-10 text-center text-ink-400">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="py-10 text-center text-ink-400">No audit events recorded.</td></tr>
                ) : filtered.map((l) => (
                  <tr key={l.id} className="bg-white hover:bg-ink-50/40 dark:bg-ink-900 dark:hover:bg-ink-800/50">
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-500">{new Date(l.created_at).toISOString()}</td>
                    <td className="px-4 py-2.5 text-ink-700 dark:text-ink-200">{l.actor_email}</td>
                    <td className="px-4 py-2.5"><Badge tone="neutral" className="!text-[10px]">{l.category}</Badge></td>
                    <td className="px-4 py-2.5 font-medium text-ink-800 dark:text-white">{l.action}</td>
                    <td className="px-4 py-2.5 text-ink-500">{l.target ?? '—'}</td>
                    <td className="px-4 py-2.5 text-ink-500">{l.location ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      {l.severity === 'critical' ? <Badge tone="danger" dot>Critical</Badge> :
                       l.severity === 'warning' ? <Badge tone="warning" dot>Warning</Badge> :
                       <Badge tone="info" dot>Info</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-ink-200/70 bg-ink-50 p-3 text-xs text-ink-500 dark:border-ink-800 dark:bg-ink-900/50">
        <Shield className="h-3.5 w-3.5 text-primary-500" />
        Immutable ledger — rows are append-only. No update or delete permissions exist on this table for any role.
      </div>
    </div>
  );
}
