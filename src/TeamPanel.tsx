import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from './ui';
import { api } from './lib';

type TeamAudit = { memberId: string; action: string; created: string };
type Membership = {
  ownerId: string;
  ownerName: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  role: 'viewer' | 'editor';
};

export function TeamPanel({
  workspaceId,
  accountId,
  onClose,
}: {
  workspaceId: string;
  accountId: string;
  onClose: () => void;
}) {
  const [team, setTeam] = useState<{
    members: Membership[];
    joined: Membership[];
    audit: TeamAudit[];
  }>();
  const [email, setEmail] = useState('');
  const [memberId, setMemberId] = useState('');
  const [role, setRole] = useState('viewer');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = () =>
    api<{ members: Membership[]; joined: Membership[]; audit: TeamAudit[] }>('/team').then(setTeam);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  async function update(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function switchTo(id?: string) {
    if (id) sessionStorage.setItem('bw-workspace', id);
    else sessionStorage.removeItem('bw-workspace');
    location.assign('/');
  }
  function add(event: FormEvent) {
    event.preventDefault();
    void update(async () => {
      await api('/team', 'POST', { email, memberId: memberId.trim(), role, confirmed });
      setEmail('');
      setMemberId('');
      setConfirmed(false);
    });
  }
  return (
    <Modal title="Teams and workspaces" onClose={onClose}>
      <div className="modal-body">
        <label>
          Your account ID
          <input readOnly value={accountId} onFocus={(event) => event.target.select()} />
        </label>
        <h3>Switch workspace</h3>
        <button onClick={() => switchTo()}>My workspace</button>
        {team?.joined.map((entry) => (
          <button
            className="recent-item"
            key={entry.ownerId}
            disabled={workspaceId === entry.ownerId}
            onClick={() => switchTo(entry.ownerId)}
          >
            <span>
              <strong>{entry.ownerName}</strong>
              <small>{entry.role}</small>
            </span>
          </button>
        ))}
        {!team && !error && <p role="status">Loading workspace access…</p>}
        <h3>People in my workspace</h3>
        <p className="muted">
          Viewers can read all records and their attachments. Editors can also create and update
          records. Owners manage sharing, billing and member access.
        </p>
        {team?.members.map((entry) => (
          <div className="actions" key={entry.memberId}>
            <span>
              {entry.memberEmail} · {entry.role}
            </span>
            <button
              disabled={busy}
              onClick={() => update(() => api('/team', 'DELETE', { memberId: entry.memberId }))}
            >
              Revoke access
            </button>
          </div>
        ))}
        <form onSubmit={add}>
          <label>
            Account ID supplied by the member
            <input
              required
              maxLength={36}
              value={memberId}
              onChange={(event) => {
                setMemberId(event.target.value);
                setConfirmed(false);
              }}
            />
          </label>
          <label>
            Existing account email
            <input
              type="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setConfirmed(false);
              }}
            />
          </label>
          <label>
            Role
            <select
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                setConfirmed(false);
              }}
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
          </label>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Grant this account access to all records in my workspace
          </label>
          <button type="submit" className="primary" disabled={!team || !confirmed || busy}>
            Save member access
          </button>
        </form>
        {!!team?.audit.length && (
          <details>
            <summary>Recent access changes</summary>
            <ul>
              {team.audit.map((event, index) => (
                <li key={index}>
                  {new Date(event.created).toLocaleString()} · {event.action} ·{' '}
                  {team.members.find((member) => member.memberId === event.memberId)?.memberEmail ||
                    event.memberId}
                </li>
              ))}
            </ul>
          </details>
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
