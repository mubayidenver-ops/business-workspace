import { useEffect, useState, type FormEvent } from 'react';
import { Copy, ShieldCheck, Trash2, UserPlus, LogOut } from 'lucide-react';
import { Modal } from './ui';
import { api, date } from './lib';
import type { User } from './types';

export function SecurityPanel({ user, onClose }: { user: User; onClose: () => void }) {
  const [status, setStatus] = useState<{ totp: boolean; recoveryCodesLeft: number } | null>(null),
    [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null),
    [codes, setCodes] = useState<string[]>([]),
    [code, setCode] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [mode, setMode] = useState<'' | 'disable' | 'delete'>(''),
    [error, setError] = useState('');
  const load = () => api<typeof status>('/security').then(setStatus, (e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  async function act(work: () => Promise<unknown>) {
    setError('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal title="Account security" onClose={onClose}>
      <div className="modal-body">
        <h3>
          <ShieldCheck size={18} /> Two-factor authentication
        </h3>
        {codes.length > 0 ? (
          <div className="copy-box">
            <p>
              Two-factor authentication is on. Save these recovery codes somewhere safe. Each works
              once if you lose your phone. They will not be shown again.
            </p>
            <code>{codes.join('\n')}</code>
            <button onClick={() => navigator.clipboard.writeText(codes.join('\n'))}>
              <Copy size={16} /> Copy codes
            </button>
          </div>
        ) : status?.totp ? (
          <p className="muted">
            On. {status.recoveryCodesLeft} recovery code{status.recoveryCodesLeft === 1 ? '' : 's'}{' '}
            left.
          </p>
        ) : setup ? (
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                const r = await api<{ recoveryCodes: string[] }>('/security/totp/enable', 'POST', {
                  code,
                });
                setCodes(r.recoveryCodes);
                setSetup(null);
                setCode('');
                await load();
              });
            }}
          >
            <p>
              Add this key to an authenticator app (Google Authenticator, 1Password, Authy…), or
              open the link on your phone.
            </p>
            <code className="secret">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
            <a href={setup.uri}>Open in authenticator app</a>
            <label>
              6-digit code from the app
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <button className="primary" type="submit">
              Turn on
            </button>
          </form>
        ) : (
          <>
            <p className="muted">Off. Add a code from your phone to every sign-in.</p>
            <button
              onClick={() =>
                act(async () => setSetup(await api('/security/totp/setup', 'POST', {})))
              }
            >
              Set up authenticator app
            </button>
          </>
        )}
        {status?.totp && !codes.length && mode !== 'disable' && (
          <button onClick={() => setMode('disable')}>Turn off two-factor</button>
        )}
        <h3>Sessions</h3>
        <p className="muted">Sign out on every device, including this one.</p>
        <button
          onClick={() =>
            act(async () => {
              await api('/security/sessions/revoke', 'POST', {});
              location.assign('/?auth=login');
            })
          }
        >
          <LogOut size={16} /> Sign out everywhere
        </button>
        <h3>Delete account</h3>
        <p className="muted">
          Permanently deletes your account, your workspace, its records and its public pages.
          Members lose access. Export a backup first.
        </p>
        {mode !== 'delete' && (
          <button className="danger" onClick={() => setMode('delete')}>
            <Trash2 size={16} /> Delete account…
          </button>
        )}
        {mode && (
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                if (mode === 'disable') {
                  await api('/security/totp/disable', 'POST', { password, code });
                  setMode('');
                  setPassword('');
                  setCode('');
                  await load();
                } else {
                  await api('/account/delete', 'POST', { password, code, confirm });
                  location.assign('/');
                }
              });
            }}
          >
            {mode === 'delete' && (
              <label>
                Type {user.email} to confirm
                <input value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </label>
            )}
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {status?.totp && (
              <label>
                Authenticator or recovery code
                <input
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </label>
            )}
            <div className="actions">
              <button type="button" onClick={() => setMode('')}>
                Cancel
              </button>
              <button className={mode === 'delete' ? 'danger' : 'primary'} type="submit">
                {mode === 'delete' ? 'Delete permanently' : 'Turn off two-factor'}
              </button>
            </div>
          </form>
        )}
        <p className="error" role="alert">
          {error}
        </p>
      </div>
    </Modal>
  );
}
