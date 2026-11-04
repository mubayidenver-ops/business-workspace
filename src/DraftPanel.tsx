import { useState } from 'react';
import { api, download } from './lib';
import { Modal } from './ui';
import type { Item } from './types';

export const aiModules = [
  'proposals',
  'invoices',
  'meetings',
  'feedback',
  'testimonials',
  'repurpose',
];

export function DraftPanel({ record, close }: { record: Item; close: () => void }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function generate() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ draft: string }>('/records/' + record.id + '/draft', 'POST', {
        version: record.version,
        confirmed: true,
      });
      setDraft(result.draft);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Draft with AI" onClose={close}>
      <div className="modal-body">
        <p>
          {record.title} · Revision {record.version}
        </p>
        <label>
          Text sent to OpenAI
          <textarea
            readOnly
            rows={6}
            value={String(record.data.notes || '')
              .trim()
              .slice(0, 6000)}
          />
        </label>
        <button
          className="primary"
          disabled={busy || !String(record.data.notes || '').trim()}
          onClick={generate}
        >
          {busy ? 'Generating…' : 'Send text and generate draft'}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {draft && (
          <>
            <label>
              Review and edit your draft
              <textarea rows={10} value={draft} onChange={(e) => setDraft(e.target.value)} />
            </label>
            <button onClick={() => download('workspace-draft.txt', draft)}>Download draft</button>
          </>
        )}
      </div>
    </Modal>
  );
}
