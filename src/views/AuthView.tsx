import { useState } from 'react';
import { Anchor, Shield, Building2, Loader2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { StandaloneBanner } from '../components/MaintenanceBanner';

export function AuthView() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [asSuperAdmin, setAsSuperAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    if (mode === 'login') {
      const { error } = await signIn(email, password);
      if (error) setError(error);
    } else {
      const { error } = await signUp(email, password, name || email.split('@')[0], asSuperAdmin);
      if (error) setError(error);
      else setError('Account created. You can now sign in.');
    }
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-ink-50 via-primary-50/30 to-ink-100 dark:from-ink-950 dark:via-ink-900 dark:to-ink-950">
      <StandaloneBanner />
      <div className="flex min-h-[calc(100vh-40px)] items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 text-white shadow-lg">
            <Anchor className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-ink-900 dark:text-white">Maritime Platform Console</h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">Multi-tenant safety management & compliance</p>
        </div>

        <div className="rounded-2xl border border-ink-200/70 bg-white p-6 shadow-xl dark:border-ink-800 dark:bg-ink-900">
          <div className="mb-5 flex gap-1 rounded-lg bg-ink-100 p-1 dark:bg-ink-800">
            <button
              onClick={() => { setMode('login'); setError(null); }}
              className={`flex-1 rounded-md py-2 text-sm font-semibold transition ${mode === 'login' ? 'bg-white text-ink-900 shadow dark:bg-ink-700 dark:text-white' : 'text-ink-500'}`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setMode('signup'); setError(null); }}
              className={`flex-1 rounded-md py-2 text-sm font-semibold transition ${mode === 'signup' ? 'bg-white text-ink-900 shadow dark:bg-ink-700 dark:text-white' : 'text-ink-500'}`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="label">Full Name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Mariner" required />
              </div>
            )}
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
            </div>
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" minLength={6} required />
            </div>
            {mode === 'signup' && (
              <label className="flex items-center gap-2 rounded-lg border border-ink-200/70 p-3 dark:border-ink-800">
                <input type="checkbox" checked={asSuperAdmin} onChange={(e) => setAsSuperAdmin(e.target.checked)} className="h-4 w-4 rounded border-ink-300 text-primary-600" />
                <span className="flex items-center gap-1.5 text-sm text-ink-700 dark:text-ink-300">
                  <Shield className="h-4 w-4 text-primary-500" />
                  Register as Super Admin (first-run bootstrap)
                </span>
              </label>
            )}
            {error && (
              <div className={`rounded-lg p-3 text-sm ${error.includes('created') ? 'bg-success-50 text-success-700 dark:bg-success-900/20 dark:text-success-400' : 'bg-danger-50 text-danger-700 dark:bg-danger-900/20 dark:text-danger-400'}`}>
                {error}
              </div>
            )}
            <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'login' ? <><Shield className="h-4 w-4" /> Sign In</> : <><Building2 className="h-4 w-4" /> Create Account</>}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-ink-400">
            {mode === 'login'
              ? 'Access is role-based. Super Admins, Company Admins, DPAs and Vessel Crew each get a dedicated workspace.'
              : 'First account can register as Super Admin. Company Admins must be provisioned by a Super Admin.'}
          </p>
        </div>
      </div>
      </div>
    </div>
  );
}
