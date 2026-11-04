import { useEffect, useState, type FormEvent } from 'react';
import { Copy, ShieldCheck, Trash2, UserPlus, LogOut } from 'lucide-react';
import { Modal } from './ui';
import { api, date } from './lib';
import type { User } from './types';

export type Role = 'owner' | 'admin' | 'member';
export type Workspace = { id: string; name: string; role: Role };
type Team = {
  role: Role;
  owner: { id: string; name: string; email?: string };
  members: { user_id: string; email: string; name: string; role: Role; joined: string }[];
  invites: { hash: string; email: string; role: Role; expires: number }[];
};
const link = (key: string, token: string) => `${location.origin}/#${key}=${token}`;

export function WorkspaceSwitcher({ current }: { current: Workspace }) {
  const [list, setList] = useState<Workspace[]>([]);
  useEffect(() => {
    api<Workspace[]>('/workspaces').then(setList, () => setList([]));
  }, []);
  if (list.length < 2) return null;
  return (
    <label>
      Switch workspace
      <select
        value={current.id}
        onChange={async (e) => {
          await api('/workspaces/active', 'POST', { id: e.target.value });
          location.assign('/');
        }}
      >
        {list.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name} · {w.role}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TeamPanel({
  workspace,
  user,
  onClose,
}: {
  workspace: Workspace;
  user: User;
  onClose: () => void;
}) {
  const [team, setTeam] = useState<Team | null>(null),
    [email, setEmail] = useState(''),
    [role, setRole] = useState<Role>('member'),
    [created, setCreated] = useState(''),
    [error, setError] = useState('');
  const manage = workspace.role !== 'member';
  const load = () => api<Team>('/team').then(setTeam, (e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  async function act(work: () => Promise<unknown>) {
    setError('');
    try {
      await work();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function invite(e: FormEvent) {
    e.preventDefault();
    await act(async () => {
      const r = await api<{ token: string }>('/team/invites', 'POST', { email, role });
      setCreated(link('invite', r.token));
      setEmail('');
    });
  }
  return (
    <Modal title="Team" onClose={onClose}>
      <div className="modal-body">
        <p className="muted">
          Everyone in <strong>{workspace.name}</strong> shares its records. Members create and edit
          records. Admins also archive, share, publish public pages and invite members. Only the
          owner manages billing and admins.
        </p>
        <ul className="team-list">
          <li>
            <span>
              <strong>{team?.owner.name || workspace.name}</strong>
              <small className="muted">{team?.owner.email}</small>
            </span>
            <span className="chip">owner</span>
          </li>
          {team?.members.map((m) => (
            <li key={m.user_id}>
              <span>
                <strong>{m.name}</strong>
                <small className="muted">
                  {m.email} · joined {date(m.joined)}
                </small>
              </span>
              {workspace.role === 'owner' ? (
                <select
                  aria-label={'Role for ' + m.email}
                  value={m.role}
                  onChange={(e) =>
                    act(() => api('/team/members/' + m.user_id, 'PATCH', { role: e.target.value }))
                  }
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              ) : (
                <span className="chip">{m.role}</span>
              )}
              {(m.user_id === user.id ||
                workspace.role === 'owner' ||
                (workspace.role === 'admin' && m.role === 'member')) && (
                <button
                  className="icon-button"
                  aria-label={m.user_id === user.id ? 'Leave workspace' : 'Remove ' + m.email}
                  onClick={() =>
                    act(async () => {
                      await api('/team/members/' + m.user_id, 'DELETE');
                      if (m.user_id === user.id) location.assign('/');
                    })
                  }
                >
                  {m.user_id === user.id ? <LogOut size={16} /> : <Trash2 size={16} />}
                </button>
              )}
            </li>
          ))}
          {team?.invites.map((i) => (
            <li key={i.hash}>
              <span>
                <strong>{i.email}</strong>
                <small className="muted">
                  Invitation expires {date(new Date(i.expires).toISOString())}
                </small>
              </span>
              <span className="chip">{i.role} · pending</span>
              <button
                className="icon-button"
                aria-label={'Revoke invitation for ' + i.email}
                onClick={() => act(() => api('/team/invites/' + i.hash, 'DELETE'))}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
        {manage && (
          <form className="form-grid" onSubmit={invite}>
            <label>
              Invite by email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Role
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="member">Member</option>
                {workspace.role === 'owner' && <option value="admin">Admin</option>}
              </select>
            </label>
            <button className="primary" type="submit">
              <UserPlus size={16} /> Create invitation link
            </button>
          </form>
        )}
        {created && (
          <div className="copy-box">
            <p>
              Send this one-time link to the person you invited. It works for 7 days and only for
              that email address.
            </p>
            <code>{created}</code>
            <button onClick={() => navigator.clipboard.writeText(created)}>
              <Copy size={16} /> Copy link
            </button>
          </div>
        )}
        <p className="error" role="alert">
          {error}
        </p>
      </div>
    </Modal>
  );
}

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
