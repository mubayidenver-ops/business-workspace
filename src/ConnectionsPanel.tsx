import { useEffect, useState } from 'react';
import { api } from './lib';
import { Modal } from './ui';

type Connections = {
  billing: 'live' | 'test' | 'disabled';
  email: boolean;
  ai: boolean;
  monitors: {
    name: string;
    label: string;
    finishedAt: string | null;
    status: 'waiting' | 'delayed' | 'errors' | 'ready';
  }[];
};

const statuses = {
  ready: 'Last run completed',
  errors: 'Last run encountered errors',
  waiting: 'Waiting for first run',
  delayed: 'Run overdue',
};

export function ConnectionsPanel({ close }: { close: () => void }) {
  const [state, setState] = useState<Connections>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api<Connections>('/connections')
      .then((result) => {
        if (active) setState(result);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <Modal title="Connections and scheduled work" onClose={close} wide>
      <div className="modal-body">
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : !state ? (
          <p role="status">Loading connection status…</p>
        ) : (
          <>
            <dl className="settings-list">
              <div>
                <dt>Paynow</dt>
                <dd>
                  {state.billing === 'live'
                    ? 'Live prepaid Pro checkout'
                    : state.billing === 'test'
                      ? 'Test mode'
                      : 'Disabled'}
                </dd>
              </div>
              <div>
                <dt>Automatic renewals</dt>
                <dd>Requires merchant tokenization and recurring checkout</dd>
              </div>
              <div>
                <dt>AI record drafts</dt>
                <dd>{state.ai ? 'Enabled for this workspace' : 'Provider setup required'}</dd>
              </div>
              <div>
                <dt>Invoice email reminders</dt>
                <dd>
                  {state.email
                    ? 'Enabled for opted-in invoices'
                    : 'Verified sender and workspace setup required'}
                </dd>
              </div>
              <div>
                <dt>Video, transcription and translation</dt>
                <dd>Provider setup and processing workflow pending</dd>
              </div>
              <div>
                <dt>Client portal and booking</dt>
                <dd>Expiring client pages, reserved booking slots and calendar export</dd>
              </div>
              <div>
                <dt>Storefront</dt>
                <dd>Manual digital delivery. Seller checkout pending.</dd>
              </div>
              <div>
                <dt>Team and recovery</dt>
                <dd>
                  Owner, editor and viewer access. Authenticator recovery codes. Email recovery
                  pending.
                </dd>
              </div>
              <div>
                <dt>Private files</dt>
                <dd>Small attachments with expiring access. Object storage pending.</dd>
              </div>
              <div>
                <dt>SMS and calendar sync</dt>
                <dd>Provider connections pending</dd>
              </div>
            </dl>
            <h3>Scheduled work</h3>
            {state.monitors.map((job) => (
              <div className="notice" key={job.name}>
                <strong>
                  {job.label} · {statuses[job.status]}
                </strong>
                {job.finishedAt && (
                  <p className="muted">{new Date(job.finishedAt).toLocaleString()}</p>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}
