import { useEffect, useState } from 'react';
import { Trash2, LogOut } from 'lucide-react';
import { Modal } from './ui';
import { api } from './lib';
import type { User } from './types';

export function SecurityPanel({ user, onClose }: { user: User; onClose: () => void }) {
  const [mfa, setMfa] = useState(false),
    [code, setCode] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [deleting, setDeleting] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    api<{ mfa: boolean }>('/security').then(
      (s) => setMfa(s.mfa),
      (e) => setError(e.message),
    );
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
    <Modal title="Sessions and account" onClose={onClose}>
      <div className="modal-body">
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
        {!deleting && (
          <button className="danger" onClick={() => setDeleting(true)}>
            <Trash2 size={16} /> Delete account…
          </button>
        )}
        {deleting && (
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                await api('/account/delete', 'POST', { password, code, confirm });
                location.assign('/');
              });
            }}
          >
            <label>
              Type {user.email} to confirm
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </label>
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
            {mfa && (
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
              <button type="button" onClick={() => setDeleting(false)}>
                Cancel
              </button>
              <button className="danger" type="submit">
                Delete permanently
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
