import { useState, type ReactNode } from 'react';
import {
  AlertTriangle, CheckCircle2, Lock, ShieldAlert, ArrowRight,
} from 'lucide-react';
import { Modal } from './Modal';
import { ProgressBar } from './ProgressBar';

export interface CriticalTarget {
  kind: 'Tenant' | 'Staff Account' | 'Document Tree / Folder' | 'Backup Snapshot' | 'SMS Tree Snapshot';
  title: string;
  subtitle: string;
  rows: { label: string; value: ReactNode }[];
  acknowledgements: string[];
  confirmPhrase: string;
  confirmHint: string;
}

export interface CriticalActionAuditPayload {
  targetKind: string;
  targetId: string;
  targetLabel: string;
  actorEmail: string;
  timestamp: string;
  details: Record<string, unknown>;
}

interface Props {
  target: CriticalTarget;
  actorEmail: string;
  onClose: () => void;
  onExecute: (payload: CriticalActionAuditPayload) => void;
}

const STEP_LABELS = ['Verify', 'Acknowledge', 'Confirm', 'Execute'] as const;

export function CriticalActionWizard({ target, actorEmail, onClose, onExecute }: Props) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [acks, setAcks] = useState<boolean[]>(() => target.acknowledgements.map(() => false));
  const [typed, setTyped] = useState('');
  const [executed, setExecuted] = useState(false);

  const allAcks = acks.every(Boolean);
  const phraseMatch = typed.trim() === target.confirmPhrase;
  const allAcksStep = step >= 2;

  const doExecute = () => {
    if (executed) return;
    setExecuted(true);
    setStep(4);
    const payload: CriticalActionAuditPayload = {
      targetKind: target.kind,
      targetId: target.subtitle,
      targetLabel: target.title,
      actorEmail,
      timestamp: new Date().toISOString(),
      details: { confirmPhrase: target.confirmPhrase, acknowledgements: target.acknowledgements },
    };
    setTimeout(() => onExecute(payload), 1500);
  };

  return (
    <Modal
      open
      onClose={() => { if (!executed) onClose(); }}
      title={`Critical Action — Delete ${target.kind}`}
      subtitle={target.subtitle}
      icon={<ShieldAlert className="h-5 w-5 text-danger-600" />}
      size="lg"
      footer={
        executed ? (
          <button disabled className="btn-secondary">Executing…</button>
        ) : (
          <>
            {step > 1 && step < 4 && (
              <button onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)} className="btn-secondary">Back</button>
            )}
            {step === 1 && (
              <button onClick={() => setStep(2)} className="btn-primary">Begin verification</button>
            )}
            {step === 2 && (
              <button onClick={() => setStep(3)} disabled={!allAcks} className="btn-danger">
                Proceed to confirmation
              </button>
            )}
            {step === 3 && (
              <button onClick={doExecute} disabled={!phraseMatch} className="btn-danger">
                <Lock className="h-4 w-4" /> Permanently delete {target.kind.toLowerCase()}
              </button>
            )}
            {step === 4 && (
              <button disabled className="btn-danger">Executing…</button>
            )}
          </>
        )
      }
    >
      {/* Horizontal stepper */}
      <div className="mb-5 flex items-center gap-2">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const active = step >= n;
          return (
            <div key={label} className="flex flex-1 items-center gap-2">
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition ${active ? 'bg-danger-600 text-white' : 'bg-ink-100 text-ink-400 dark:bg-ink-800'}`}>
                {step > n ? <CheckCircle2 className="h-4 w-4" /> : n}
              </div>
              <span className={`text-xs font-semibold ${active ? 'text-ink-800 dark:text-ink-100' : 'text-ink-400'}`}>{label}</span>
              {n < 4 && <div className={`h-0.5 flex-1 ${step > n ? 'bg-danger-500' : 'bg-ink-200 dark:bg-ink-700'}`} />}
            </div>
          );
        })}
      </div>

      {/* Step 1 — Verify Details */}
      {step === 1 && (
        <div className="space-y-3">
          <div className="rounded-xl border border-ink-200/70 p-4 dark:border-ink-800">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-500">{target.kind} details</p>
            <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
              {target.rows.map((row) => (
                <div key={row.label} className={row.label === 'Name' || row.label === 'Tenant ID' ? 'col-span-2' : ''}>
                  <span className="text-ink-500">{row.label}:</span>{' '}
                  <span className="font-semibold text-ink-800 dark:text-ink-100">{row.value}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-lg bg-warning-50 p-3 text-xs text-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              This will <strong>permanently delete</strong> <strong>{target.title}</strong>. The operation is irreversible.
              Please review every field above carefully before proceeding.
            </span>
          </div>
        </div>
      )}

      {/* Step 2 — Acknowledge Impact */}
      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">
            You must acknowledge every risk below before the next step is enabled.
          </p>
          {target.acknowledgements.map((text, i) => (
            <label
              key={i}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-200/70 p-3 transition hover:border-danger-300 dark:border-ink-800 dark:hover:border-danger-900/50"
            >
              <input
                type="checkbox"
                checked={acks[i]}
                onChange={(e) => setAcks((a) => a.map((v, idx) => (idx === i ? e.target.checked : v)))}
                className="mt-0.5 h-4 w-4 rounded border-ink-300 text-danger-600 focus:ring-danger-500"
              />
              <span className="text-sm text-ink-700 dark:text-ink-200">{text}</span>
            </label>
          ))}
          {!allAcks && (
            <p className="text-xs text-ink-400">
              {acks.filter(Boolean).length} of {acks.length} acknowledgements checked.
            </p>
          )}
        </div>
      )}

      {/* Step 3 — String Confirmation */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="rounded-lg bg-danger-50 p-3 text-sm text-danger-800 dark:bg-danger-900/20 dark:text-danger-300">
            <Lock className="mr-1.5 inline h-4 w-4" />
            To execute this deletion, type the exact confirmation phrase below.
          </div>
          <div>
            <label className="label">
              Type exactly: <span className="font-mono text-danger-600 dark:text-danger-400">{target.confirmPhrase}</span>
            </label>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={target.confirmHint}
              className={`input ${typed && !phraseMatch ? 'border-danger-400 focus:ring-danger-500/20' : typed && phraseMatch ? 'border-success-400 focus:ring-success-500/20' : ''}`}
            />
            {typed && (
              <p className={`mt-1.5 text-xs ${phraseMatch ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`}>
                {phraseMatch ? (
                  <><CheckCircle2 className="mr-1 inline h-3 w-3" />Phrase matches — deletion armed.</>
                ) : (
                  <><AlertTriangle className="mr-1 inline h-3 w-3" />Phrase does not match yet.</>
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Step 4 — Execution & Audit */}
      {step === 4 && (
        <div className="space-y-4 py-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-danger-100 dark:bg-danger-900/40">
            <ShieldAlert className="h-7 w-7 animate-pulse-soft text-danger-600 dark:text-danger-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-ink-900 dark:text-white">Deleting {target.title}…</p>
            <p className="mt-1 text-xs text-ink-500">Deletion in progress · audit ledger entry dispatched</p>
          </div>
          <div className="mx-auto max-w-xs">
            <ProgressBar value={100} tone="danger" indeterminate size="lg" />
          </div>
          <div className="inline-flex items-center gap-2 rounded-lg bg-ink-50 px-3 py-1.5 font-mono text-xs text-ink-500 dark:bg-ink-800/50">
            <ArrowRight className="h-3 w-3" /> audit entry: {target.kind} → {target.title}
          </div>
        </div>
      )}
    </Modal>
  );
}
