import { useState, type ReactNode } from 'react';
import {
  CreditCard, Sliders, Receipt, CalendarClock, Mail, Clock, Download, Plus, DollarSign, FileText, AlertTriangle, CheckCircle2, Lock, Unlock, Send, Trash2, ShieldAlert, KeyRound, X,
} from 'lucide-react';
import { Card } from '../components/Card';
import { Badge, StatusBadge } from '../components/Badge';
import { DataTable, type Column } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { useStore } from '../store';
import { daysUntil, formatCurrency, formatGb, relativeTime, formatUtc } from '../constants';
import type { Invoice, InvoiceLineItem, PlanTier, Tenant, TierConfig } from '../types';
import type { Capabilities } from '../lib/permissions';

export function BillingView({ caps }: { caps: Capabilities }) {
  const { invoices, tenants, tierConfigs, dispatch, toast } = useStore();
  const [dirty, setDirty] = useState(false);
  const [emailPreview, setEmailPreview] = useState<Tenant | null>(null);
  const [emailDraft, setEmailDraft] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [editEmailFor, setEditEmailFor] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState('');
  const [deleteFor, setDeleteFor] = useState<Tenant | null>(null);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  const [genOpen, setGenOpen] = useState(false);

  const overLimitCount = tenants.filter((t) => t.vessels.used > t.vessels.max || t.seats.used > t.seats.max || t.storageGb.used > t.storageGb.max).length;

  const invoiceColumns: Column<Invoice>[] = [
    { key: 'id', header: 'Invoice', sortValue: (i) => i.id, render: (i) => <span className="font-mono text-xs font-semibold text-ink-800 dark:text-ink-100">{i.id}</span> },
    { key: 'company', header: 'Company', sortValue: (i) => i.company, render: (i) => <div><p className="text-sm font-medium text-ink-800 dark:text-ink-100">{i.company}</p><p className="text-xs text-ink-500">{i.tenantId}</p></div> },
    { key: 'period', header: 'Period', sortValue: (i) => i.period, render: (i) => i.period },
    { key: 'amount', header: 'Amount', sortValue: (i) => i.amount, render: (i) => <span className="font-semibold text-ink-800 dark:text-ink-100">{formatCurrency(i.amount, i.currency)}</span> },
    { key: 'issued', header: 'Issued', sortValue: (i) => i.issued, render: (i) => <span className="text-xs text-ink-500">{relativeTime(i.issued)}</span> },
    { key: 'status', header: 'Status', sortValue: (i) => i.status, render: (i) => <StatusBadge status={i.status} /> },
    {
      key: 'actions', header: 'Receipt',
      render: (i) => (
        <button onClick={() => toast({ tone: 'info', title: 'Receipt generated', message: `${i.id}.pdf prepared for download.` })} className="btn-ghost rounded-md p-1.5" title="Download receipt PDF">
          <Download className="h-4 w-4" />
        </button>
      ),
    },
  ];

  const expiring = tenants.map((t) => ({ tenant: t, days: daysUntil(t.contractExpires) })).sort((a, b) => a.days - b.days);

  const updateTier = (idx: number, patch: Partial<TierConfig>) => {
    if (!caps.billingEdit) return;
    // Bind directly to the store so tenant ledger limits recalculate live
    dispatch({ type: 'TIER_CONFIG_UPDATE', index: idx, patch });
    setDirty(true);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink-900 dark:text-white">Billing & Subscription Management</h1>
        <p className="text-sm text-ink-500 dark:text-ink-400">SaaS tier constructor, transaction vault & contract lifecycle.</p>
      </div>

      {/* SaaS Tier Constructor */}
      <Card
        title="SaaS Tier Constructor"
        subtitle="Adjust pricing & quota thresholds — cascades live into the Tenant Ledger"
        icon={<Sliders className="h-4 w-4" />}
        actions={
          <div className="flex items-center gap-2">
            {overLimitCount > 0 && <Badge tone="danger" dot pulse>{overLimitCount} over limit</Badge>}
            {dirty ? (
              <button
                onClick={() => { setDirty(false); toast({ tone: 'success', title: 'Tier configuration saved', message: 'Quota thresholds cascaded to all tenants on this tier.' }); }}
                className="btn-primary"
              >Save tiers</button>
            ) : <Badge tone="success" dot>Synced</Badge>}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-50/80 text-xs uppercase tracking-wide text-ink-500 dark:bg-ink-950/50 dark:text-ink-400">
              <tr>
                <th className="px-3 py-1.5 font-semibold">Plan</th>
                <th className="px-3 py-1.5 font-semibold">Monthly</th>
                <th className="px-3 py-1.5 font-semibold">Annual</th>
                <th className="px-3 py-1.5 font-semibold">Vessels</th>
                <th className="px-3 py-1.5 font-semibold">Storage (GB)</th>
                <th className="px-3 py-1.5 font-semibold">Seats</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {tierConfigs.map((t, i) => (
                <tr key={t.name} className="bg-white dark:bg-ink-900">
                  <td className="px-3 py-1"><span className="font-bold text-ink-900 dark:text-white">{t.name}</span></td>
                  <td className="px-3 py-1"><input type="number" value={t.monthly} disabled={!caps.billingEdit} onChange={(e) => updateTier(i, { monthly: +e.target.value })} className="input w-24 py-1 text-sm disabled:opacity-60" /></td>
                  <td className="px-3 py-1"><input type="number" value={t.annual} disabled={!caps.billingEdit} onChange={(e) => updateTier(i, { annual: +e.target.value })} className="input w-24 py-1 text-sm disabled:opacity-60" /></td>
                  <td className="px-3 py-1"><input type="number" value={t.vessels} disabled={!caps.billingEdit} onChange={(e) => updateTier(i, { vessels: +e.target.value })} className="input w-20 py-1 text-sm disabled:opacity-60" /></td>
                  <td className="px-3 py-1"><input type="number" value={t.storageGb} disabled={!caps.billingEdit} onChange={(e) => updateTier(i, { storageGb: +e.target.value })} className="input w-24 py-1 text-sm disabled:opacity-60" /></td>
                  <td className="px-3 py-1"><input type="number" value={t.seats} disabled={!caps.billingEdit} onChange={(e) => updateTier(i, { seats: +e.target.value })} className="input w-20 py-1 text-sm disabled:opacity-60" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!caps.billingEdit && (
            <p className="mt-2 rounded-lg bg-ink-50 p-2 text-xs text-ink-500 dark:bg-ink-800/50 dark:text-ink-400">
              Tier construction is read-only for your role. Editing is restricted to Super-Admin.
            </p>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Transaction Vault */}
        <div className="lg:col-span-2">
          <Card
            title="Central Transaction Vault"
            subtitle="Historical invoices across all tenants"
            icon={<Receipt className="h-4 w-4" />}
            actions={
              <button
                onClick={() => setGenOpen(true)}
                disabled={!caps.billingEdit}
                className="btn-secondary shrink-0 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
              ><Plus className="h-4 w-4" /> Generate invoice</button>
            }
          >
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-primary-50 p-3 text-xs text-primary-700 dark:bg-primary-900/20 dark:text-primary-300">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Recurring monthly invoices generate <strong>automatically</strong> on each tenant's renewal date based on active vessel count. Use <strong>Generate invoice</strong> to create ad-hoc invoices manually.</span>
            </div>
            <DataTable columns={invoiceColumns} rows={invoices} pageSize={8} searchable searchPlaceholder="Search invoices, companies…" searchFn={(i, q) => i.id.toLowerCase().includes(q) || i.company.toLowerCase().includes(q)} />
          </Card>
        </div>

        {/* Contract Lifecycle */}
        <Card title="Contract Lifecycle Monitor" subtitle="Renewals within 90-day window · configurable recipient emails" icon={<CalendarClock className="h-4 w-4" />}>
          <div className="space-y-2.5">
            {expiring.map(({ tenant, days }) => {
              const tone = days < 30 ? 'danger' : days < 60 ? 'warning' : 'neutral';
              const label = days < 0 ? 'Expired' : `${days}d left`;
              const isEditing = editEmailFor === tenant.id;
              const isLocked = !isEditing;
              return (
                <div key={tenant.id} className={`rounded-lg border p-3 ${tone === 'danger' ? 'border-danger-200 bg-danger-50/40 dark:border-danger-900/50 dark:bg-danger-900/10' : tone === 'warning' ? 'border-warning-200 bg-warning-50/40 dark:border-warning-900/50 dark:bg-warning-900/10' : 'border-ink-200/70 dark:border-ink-800'}`}>
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-900 dark:text-white">{tenant.company}</p>
                      <p className="text-xs text-ink-500">Expires {new Date(tenant.contractExpires).toLocaleDateString('en-GB')} · {formatCurrency(tenant.monthlyRevenue)}/mo</p>
                    </div>
                    <Badge tone={tone === 'neutral' ? 'neutral' : tone}>{label}</Badge>
                  </div>

                  {/* Tier 1: Locked Recipient Email Field */}
                  <div className="mt-2.5">
                    <label className="text-[10px] font-bold uppercase tracking-wide text-ink-400">Recipient Email(s)</label>
                    <div className="mt-1 flex items-center gap-1.5">
                      <div className={`relative flex-1 ${isLocked ? 'opacity-90' : ''}`}>
                        <input
                          type="email"
                          value={isEditing ? pendingEmail : tenant.contactEmail}
                          readOnly={isLocked}
                          onChange={(e) => setPendingEmail(e.target.value)}
                          className={`input py-1.5 text-xs ${isLocked ? 'bg-ink-50/70 dark:bg-ink-800/40' : 'border-primary-400 ring-2 ring-primary-500/10'} pl-8`}
                        />
                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400">
                          {isLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5 text-primary-500" />}
                        </span>
                      </div>
                      {/* Lock/Edit Toggle */}
                      <button
                        onClick={() => {
                          if (isEditing) {
                            // Save email via TENANT_UPDATE
                            dispatch({ type: 'TENANT_UPDATE', id: tenant.id, patch: { contactEmail: pendingEmail } });
                            toast({ tone: 'success', title: 'Recipient email saved', message: `${tenant.company} → ${pendingEmail}` });
                            setEditEmailFor(null);
                          } else {
                            setPendingEmail(tenant.contactEmail);
                            setEditEmailFor(tenant.id);
                          }
                        }}
                        className={`btn-ghost rounded-md p-1.5 ${isEditing ? 'text-primary-600 dark:text-primary-400' : 'text-ink-400'}`}
                        title={isEditing ? 'Save email' : 'Unlock to edit'}
                      >
                        {isEditing ? <CheckCircle2 className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                      </button>
                      {isEditing && (
                        <button
                          onClick={() => setEditEmailFor(null)}
                          className="btn-ghost rounded-md p-1.5 text-ink-400"
                          title="Cancel edit"
                        ><X className="h-4 w-4" /></button>
                      )}
                    </div>
                  </div>

                  <div className="mt-2.5 flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        setEmailPreview(tenant);
                        setEmailDraft(buildRenewalEmail(tenant));
                      }}
                      className="btn-secondary flex-1 text-xs py-1.5"
                    ><Mail className="h-3.5 w-3.5" /> Renewal email</button>
                    {/* Tier 2+3: Delete / remove config button */}
                    <button
                      onClick={() => { setDeleteFor(tenant); setDeleteStep(1); setDeleteTyped(''); }}
                      className="btn-ghost rounded-md p-1.5 text-xs text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-900/30"
                      title="Remove renewal configuration"
                    ><Trash2 className="h-3.5 w-3.5" /></button>
                    <button
                      onClick={() => toast({ tone: 'success', title: 'Extension granted', message: `30-day temporary access extension for ${tenant.company}.` })}
                      className="btn-ghost rounded-md p-1.5 text-xs"
                      title="Grant temporary extension"
                    ><Clock className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Revenue summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <RevCard icon={<DollarSign className="h-5 w-5" />} label="MRR" value={formatCurrency(tenants.filter((t) => t.status !== 'archived').reduce((s, t) => s + t.monthlyRevenue, 0))} sub="Monthly recurring revenue (archived excluded)" />
        <RevCard icon={<FileText className="h-5 w-5" />} label="Invoices this year" value={String(invoices.length)} sub={`${invoices.filter((i) => i.status === 'paid').length} paid · ${invoices.filter((i) => i.status === 'overdue').length} overdue`} />
        <RevCard icon={<AlertTriangle className="h-5 w-5" />} label="Overdue balance" value={formatCurrency(invoices.filter((i) => i.status === 'overdue').reduce((s, i) => s + i.amount, 0))} sub="Requires collection action" tone="warning" />
      </div>

      {/* Renewal Email Preview Modal */}
      {emailPreview && (
        <Modal
          open
          onClose={() => { setEmailPreview(null); setEmailSending(false); }}
          title="Renewal Email Preview"
          subtitle={`Dispatch to ${emailPreview.company}`}
          icon={<Mail className="h-5 w-5" />}
          size="lg"
          footer={
            <>
              <button onClick={() => { setEmailPreview(null); setEmailSending(false); }} className="btn-secondary">Close</button>
              <button
                onClick={() => {
                  setEmailSending(true);
                  setTimeout(() => {
                    toast({ tone: 'success', title: 'Reminder email sent', message: `Renewal notice dispatched to ${emailPreview.contactEmail}.` });
                    setEmailPreview(null);
                    setEmailSending(false);
                  }, 900);
                }}
                disabled={emailSending}
                className="btn-primary"
              >
                {emailSending ? <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4 animate-spin" style={{ animationDuration: '1s' }} /> Sending…</span> : <><Send className="h-4 w-4" /> Send Reminder Email Now</>}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="grid grid-cols-[60px_1fr] gap-x-3 gap-y-2 rounded-xl border border-ink-200 bg-ink-50/60 p-4 text-sm dark:border-ink-800 dark:bg-ink-800/40">
              <span className="font-semibold text-ink-500">To:</span>
              <span className="font-mono text-ink-800 dark:text-ink-100">{emailPreview.contactEmail}</span>
              <span className="font-semibold text-ink-500">Subject:</span>
              <span className="font-semibold text-ink-800 dark:text-ink-100">Action Required: Subscription Renewal Notice — {emailPreview.company}</span>
            </div>
            <div>
              <label className="label">Email body (editable)</label>
              <textarea
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                rows={12}
                className="input resize-none font-mono text-xs leading-relaxed"
              />
            </div>
            <div className="rounded-lg bg-primary-50 p-2.5 text-xs text-primary-700 dark:bg-primary-900/20 dark:text-primary-300">
              <CheckCircle2 className="mr-1.5 inline h-3.5 w-3.5" />
              Plan: {emailPreview.plan} · Expiry: {new Date(emailPreview.contractExpires).toLocaleDateString('en-GB')} · MRR: {formatCurrency(emailPreview.monthlyRevenue)}/mo
            </div>
          </div>
        </Modal>
      )}

      {/* Tier 2+3: Delete / Remove Configuration Safeguard Modal */}
      {deleteFor && (
        <Modal
          open
          onClose={() => { setDeleteFor(null); setDeleteTyped(''); setDeleteStep(1); }}
          title="Remove Renewal Configuration"
          subtitle={`${deleteFor.company} · ${deleteFor.id}`}
          icon={<ShieldAlert className="h-5 w-5" />}
          size="md"
          footer={
            <>
              <button onClick={() => { setDeleteFor(null); setDeleteTyped(''); setDeleteStep(1); }} className="btn-secondary">Cancel</button>
              {deleteStep === 1 && (
                <button onClick={() => setDeleteStep(2)} className="btn-danger"><Trash2 className="h-4 w-4" /> Yes, continue</button>
              )}
              {deleteStep === 2 && (
                <button
                  onClick={() => {
                    // Clear the renewal config email and audit-log it
                    dispatch({ type: 'TENANT_UPDATE', id: deleteFor.id, patch: { contactEmail: '' } });
                    toast({ tone: 'danger', title: 'Configuration removed', message: `Renewal configuration for ${deleteFor.company} has been wiped. Audit logged.` });
                    setDeleteFor(null);
                    setDeleteTyped('');
                    setDeleteStep(1);
                  }}
                  disabled={deleteTyped.trim().toUpperCase() !== 'DELETE'}
                  className="btn-danger disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <KeyRound className="h-4 w-4" /> Confirm removal
                </button>
              )}
            </>
          }
        >
          {deleteStep === 1 ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg bg-danger-50 p-3 text-sm text-danger-800 dark:bg-danger-900/20 dark:text-danger-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Are you sure you want to remove the renewal configuration for <strong>{deleteFor.company}</strong>? This will clear the recipient email and halt automated renewal reminders.</span>
              </div>
              <div className="rounded-lg border border-ink-200/70 p-3 text-xs text-ink-500 dark:border-ink-800">
                <div className="flex items-center justify-between">
                  <span>Recipient email</span>
                  <span className="font-mono text-ink-700 dark:text-ink-200">{deleteFor.contactEmail || '—'}</span>
                </div>
                <div className="mt-1.5 flex items-center justify-between">
                  <span>Plan / expiry</span>
                  <span className="text-ink-700 dark:text-ink-200">{deleteFor.plan} · {new Date(deleteFor.contractExpires).toLocaleDateString('en-GB')}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg bg-danger-50 p-3 text-sm text-danger-800 dark:bg-danger-900/20 dark:text-danger-300">
                <ShieldAlert className="mr-1.5 inline h-4 w-4" />
                <strong>Tier 3 — Final safeguard:</strong> Type <span className="font-mono font-bold text-danger-600 dark:text-danger-400">DELETE</span> below to permanently remove the renewal configuration for <strong>{deleteFor.company}</strong>.
              </div>
              <div>
                <label className="label">Type DELETE to confirm</label>
                <input
                  autoFocus
                  value={deleteTyped}
                  onChange={(e) => setDeleteTyped(e.target.value)}
                  placeholder="DELETE"
                  className={`input font-mono ${deleteTyped && deleteTyped.trim().toUpperCase() !== 'DELETE' ? 'border-danger-400 focus:ring-danger-500/20' : deleteTyped.trim().toUpperCase() === 'DELETE' ? 'border-success-400 focus:ring-success-500/20' : ''}`}
                />
                {deleteTyped && (
                  <p className={`mt-1.5 text-xs ${deleteTyped.trim().toUpperCase() === 'DELETE' ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`}>
                    {deleteTyped.trim().toUpperCase() === 'DELETE'
                      ? <><CheckCircle2 className="mr-1 inline h-3 w-3" />Confirmed — removal armed.</>
                      : <><AlertTriangle className="mr-1 inline h-3 w-3" />Type the full word DELETE to proceed.</>}
                  </p>
                )}
              </div>
            </div>
          )}
        </Modal>
      )}

      {genOpen && (
        <GenerateInvoiceModal
          tenants={tenants.filter((t) => t.status !== 'archived')}
          onClose={() => setGenOpen(false)}
          onSubmit={(inv) => {
            dispatch({ type: 'INVOICE_ADD', invoice: inv });
            toast({ tone: 'success', title: 'Invoice generated', message: `${inv.id} created for ${inv.company}.` });
            setGenOpen(false);
          }}
        />
      )}
    </div>
  );
}

function RevCard({ icon, label, value, sub, tone = 'success' }: { icon: ReactNode; label: string; value: string; sub: string; tone?: 'success' | 'warning' | 'danger' }) {
  const tones = {
    success: 'bg-success-50 text-success-700 dark:bg-success-900/30 dark:text-success-300',
    warning: 'bg-warning-50 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300',
    danger: 'bg-danger-50 text-danger-700 dark:bg-danger-900/30 dark:text-danger-300',
  };
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>{icon}</div>
        <CheckCircle2 className="h-4 w-4 text-ink-300" />
      </div>
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink-900 dark:text-white">{value}</p>
      <p className="mt-0.5 text-xs text-ink-500">{sub}</p>
    </div>
  );
}

function GenerateInvoiceModal({ tenants, onClose, onSubmit }: {
  tenants: Tenant[];
  onClose: () => void;
  onSubmit: (invoice: Invoice) => void;
}) {
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([
    { description: 'Monthly platform subscription', amount: 0 },
  ]);

  const selected = tenants.find((t) => t.id === tenantId);
  const lineTotal = lineItems.reduce((s, li) => s + (Number(li.amount) || 0), 0);
  const finalAmount = Number(amount) || lineTotal;
  const valid = !!tenantId && finalAmount > 0 && !!dueDate;

  const submit = () => {
    if (!valid || !selected) return;
    const inv: Invoice = {
      id: `INV-${Date.now().toString().slice(-6)}`,
      tenantId: selected.id,
      company: selected.company,
      amount: finalAmount,
      currency: 'USD',
      period: dueDate ? new Date(dueDate).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : 'Ad-hoc',
      issued: new Date().toISOString(),
      status: 'draft',
      lineItems: lineItems.filter((li) => li.description.trim()),
      dueDate,
    };
    onSubmit(inv);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Generate Ad-Hoc Invoice"
      subtitle="Manual invoice creation · syncs immediately to Central Transaction Vault"
      icon={<Receipt className="h-5 w-5" />}
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={submit} disabled={!valid} className="btn-primary disabled:cursor-not-allowed disabled:opacity-50">
            <Plus className="h-4 w-4" /> Create draft invoice
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label">Tenant</label>
          <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="input">
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.company} — {t.id}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Billing Amount (USD)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={lineTotal > 0 ? String(lineTotal) : '0.00'}
              className="input"
            />
            {lineTotal > 0 && !amount && (
              <p className="mt-1 text-xs text-ink-500">Auto-filled from line items: {formatCurrency(lineTotal)}</p>
            )}
          </div>
          <div>
            <label className="label">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="input"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="label mb-0">Line Items</label>
            <button
              onClick={() => setLineItems([...lineItems, { description: '', amount: 0 }])}
              className="btn-ghost rounded-md p-1 text-xs font-semibold text-primary-600 dark:text-primary-400"
            >
              <Plus className="h-3 w-3" /> Add line
            </button>
          </div>
          <div className="mt-1.5 space-y-2">
            {lineItems.map((li, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={li.description}
                  onChange={(e) => {
                    const next = [...lineItems];
                    next[i] = { ...li, description: e.target.value };
                    setLineItems(next);
                  }}
                  placeholder="Line item description"
                  className="input flex-1 text-sm"
                />
                <input
                  type="number"
                  value={li.amount || ''}
                  onChange={(e) => {
                    const next = [...lineItems];
                    next[i] = { ...li, amount: Number(e.target.value) || 0 };
                    setLineItems(next);
                  }}
                  placeholder="0"
                  className="input w-28 text-sm"
                />
                {lineItems.length > 1 && (
                  <button
                    onClick={() => setLineItems(lineItems.filter((_, idx) => idx !== i))}
                    className="btn-ghost rounded-md p-1.5 text-ink-400 hover:text-danger-500"
                    title="Remove line"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2 dark:bg-ink-800/50">
            <span className="text-xs font-semibold text-ink-500">Line items total</span>
            <span className="text-sm font-bold text-ink-900 dark:text-white">{formatCurrency(lineTotal)}</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function buildRenewalEmail(t: Tenant): string {
  const expiry = new Date(t.contractExpires).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return `Dear ${t.company} Team,

This is a formal reminder that your Maritimos subscription is due for renewal.

Plan details:
  - Company: ${t.company} (${t.id})
  - Current plan: ${t.plan}
  - Monthly billing: ${formatCurrency(t.monthlyRevenue)} / month
  - Renewal / expiry date: ${expiry}
  - Days remaining: ${daysUntil(t.contractExpires)} day(s)

To avoid service interruption, please complete your renewal payment before the
expiry date using the secure payment link below:

  https://pay.maritimos.io/renew/${t.id}

If you have any questions or need to update your billing details, please contact
our accounts team at accounts@maritimos.io.

Kind regards,
Maritimos Platform — Billing & Subscriptions`;
}
