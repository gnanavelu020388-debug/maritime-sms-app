import { ShieldAlert, LogOut, Eye } from 'lucide-react';
import { useStore } from '../store';

export function ImpersonationOverlay() {
  const { impersonation, tenants, dispatch, toast } = useStore();
  if (!impersonation.active) return null;
  const tenant = tenants.find((t) => t.id === impersonation.tenantId);
  return (
    <div className="fixed inset-x-0 top-0 z-50 animate-slide-down">
      <div className="flex flex-col gap-2 bg-danger-600 px-4 py-2.5 text-white shadow-elev-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest opacity-90">
          <ShieldAlert className="h-4 w-4" />
          Impersonation Mode Active
        </div>
        <div className="hidden h-4 w-px bg-white/30 sm:block" />
        <div className="flex flex-1 items-center gap-2 text-sm">
          <Eye className="h-4 w-4 opacity-80" />
          <span>
            Simulating Session As{' '}
            <span className="font-bold underline decoration-white/40 decoration-2 underline-offset-2">{tenant?.company}</span> Admin
            <span className="ml-2 rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">Read-Only Audit Mode</span>
          </span>
        </div>
        <button
          onClick={() => {
            dispatch({ type: 'IMPERSONATE_END' });
            toast({ tone: 'success', title: 'Returned to Super Admin Panel', message: 'Impersonation session ended and recorded in the audit ledger.' });
          }}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-danger-700 shadow-sm hover:bg-danger-50"
        >
          <LogOut className="h-3.5 w-3.5" />
          Return to Super Admin Panel
        </button>
      </div>
    </div>
  );
}
