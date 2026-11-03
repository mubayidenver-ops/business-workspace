import { useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { Modal } from './ui';
import { api } from './lib';
export function PasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState(''),
    [next, setNext] = useState(''),
    [confirm, setConfirm] = useState(''),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const ref = useRef<HTMLFormElement>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    const invalid = Array.from(ref.current?.elements || []).find(
      (el) => el instanceof HTMLInputElement && !el.validity.valid,
    ) as HTMLInputElement | undefined;
    if (invalid) {
      setError('Complete all fields using passwords of 10–128 characters.');
      invalid.focus();
      return;
    }
    if (next !== confirm) {
      setError('The new passwords do not match.');
      document.getElementById('confirm-password')?.focus();
      return;
    }
    setBusy(true);
    try {
      await api('/password', 'POST', { currentPassword: current, newPassword: next });
      location.assign('/?auth=login');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Change your password"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="modal-body" noValidate ref={ref} onSubmit={submit}>
        <div className="integration-note">
          <ShieldCheck size={20} />
          <span>
            Changing your password signs out every session, including this one. Sign back in with
            your new password.
          </span>
        </div>
        <label htmlFor="current-password">
          Current password
          <input
            id="current-password"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            required
            minLength={10}
            maxLength={128}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            aria-describedby="password-error"
          />
        </label>
        <label htmlFor="new-password">
          New password
          <input
            id="new-password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={128}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            aria-describedby="password-error"
          />
        </label>
        <label htmlFor="confirm-password">
          Confirm new password
          <input
            id="confirm-password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={128}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-describedby="password-error"
          />
        </label>
        <button type="button" aria-pressed={show} onClick={() => setShow(!show)}>
          {show ? <EyeOff size={16} /> : <Eye size={16} />}{' '}
          {show ? 'Hide passwords' : 'Show passwords'}
        </button>
        <p className="error" id="password-error" role="alert">
          {error}
        </p>
        <footer className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Changing…' : 'Change password'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
