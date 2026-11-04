import { useEffect, useState, type FormEvent } from 'react';
import { api, download } from './lib';
import { Modal } from './ui';

export function MfaPanel({ close }: { close: () => void }) {
  const [status, setStatus] = useState<{ enabled: boolean; available: boolean }>();
  const [enrollment, setEnrollment] = useState<{ token: string; secret: string }>();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const signIn = () => location.assign('/?auth=login');
  useEffect(() => {
    void api<{ enabled: boolean; available: boolean }>('/mfa')
      .then(setStatus)
      .catch((e) => setError(e.message));
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !status?.available) return;
    setError('');
    setBusy(true);
    try {
      if (status.enabled) {
        await api('/mfa', 'POST', { action: 'disable', password, code });
        signIn();
      } else if (enrollment) {
        const result = await api<{ recoveryCodes: string[] }>('/mfa', 'POST', {
          action: 'enable',
          password,
          code,
          token: enrollment.token,
        });
        setPassword('');
        setCode('');
        setRecovery(result.recoveryCodes);
      } else {
        setEnrollment(
          await api<{ token: string; secret: string }>('/mfa', 'POST', {
            action: 'setup',
            password,
          }),
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Two-step sign-in"
      onClose={() => {
        if (!busy && !recovery) close();
      }}
    >
      <div className="modal-body">
        {recovery ? (
          <>
            <h3>Save your recovery codes</h3>
            <p>
              Each code works once. Keep these somewhere safe. After saving them, sign in with a new
              authenticator code.
            </p>
            <pre>{recovery.join('\n')}</pre>
            <div className="actions">
              <button
                onClick={() =>
                  download('business-workspace-recovery-codes.txt', recovery.join('\n'))
                }
              >
                Download codes
              </button>
              <button className="primary" onClick={signIn}>
                Continue to sign in
              </button>
            </div>
          </>
        ) : status?.available ? (
          <form onSubmit={submit}>
            <p>
              {status.enabled
                ? 'Authenticator protection is enabled.'
                : 'Use an authenticator app to protect your account.'}
            </p>
            {enrollment && (
              <label>
                Add this setup key to your authenticator (time-based)
                <input readOnly value={enrollment.secret} onFocus={(e) => e.target.select()} />
              </label>
            )}
            <label>
              Current password
              <input
                required
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {(status.enabled || enrollment) && (
              <label>
                {status.enabled ? 'Authenticator or recovery code' : 'Six-digit authenticator code'}
                <input
                  required
                  autoComplete="one-time-code"
                  maxLength={24}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
            )}
            <button className="primary" disabled={busy}>
              {busy
                ? 'Working…'
                : status.enabled
                  ? 'Turn off two-step sign-in'
                  : enrollment
                    ? 'Enable two-step sign-in'
                    : 'Start setup'}
            </button>
          </form>
        ) : (
          <p>{status ? 'Authenticator setup is unavailable.' : 'Loading security settings…'}</p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
