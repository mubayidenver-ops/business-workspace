import { useRef, useState } from 'react';
import { Modal } from './ui';
import { api } from './lib';
import type { Tool } from './types';

type BackupRecord = { title: string; module: string; data: Record<string, unknown> };

export function ImportPanel({
  tools,
  close,
  refresh,
}: {
  tools: Tool[];
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const [records, setRecords] = useState<BackupRecord[]>([]);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const key = useRef('');
  const batch: BackupRecord[] = [];
  const encoder = new TextEncoder();
  for (const record of records.slice(cursor, cursor + 20)) {
    if (encoder.encode(JSON.stringify([...batch, record])).length > 240000) break;
    batch.push(record);
  }

  async function load(file: File | undefined) {
    if (!file) return;
    setError('');
    setMessage('');
    setRecords([]);
    setCursor(0);
    setConfirmed(false);
    if (file.size > 40 * 1024 * 1024) {
      setError('Choose a backup file under 40 MiB.');
      return;
    }
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed?.records) || !parsed.records.length || parsed.records.length > 1000)
        throw new Error('Choose a Business Workspace backup with 1 to 1,000 records.');
      const available = new Set(tools.map((tool) => tool.id));
      const next = parsed.records.map((entry: BackupRecord, index: number) => {
        if (
          !entry ||
          typeof entry.title !== 'string' ||
          !entry.title.trim() ||
          !available.has(entry.module) ||
          !entry.data ||
          typeof entry.data !== 'object' ||
          Array.isArray(entry.data)
        )
          throw new Error('Record ' + (index + 1) + ' is missing its title, tool or details.');
        return { title: entry.title, module: entry.module, data: entry.data };
      });
      if (
        next.some((record: BackupRecord) => encoder.encode(JSON.stringify(record)).length > 239000)
      )
        throw new Error(
          'A record exceeds the import size limit. Reduce that record’s data in the backup.',
        );
      key.current = crypto.randomUUID();
      setRecords(next);
    } catch (error) {
      setError(
        error instanceof SyntaxError ? 'This file is not valid JSON.' : (error as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function importBatch() {
    if (!confirmed || busy || !batch.length) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api<{ count: number }>('/import', 'POST', {
        records: batch,
        requestKey: key.current,
      });
      setCursor((previous) => previous + result.count);
      setConfirmed(false);
      key.current = crypto.randomUUID();
      setMessage('Imported ' + result.count + ' records as drafts.');
      await refresh().catch(() =>
        setMessage('Records imported. Refresh the workspace to see them.'),
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Import backup records"
      onClose={() => {
        if (!busy) close();
      }}
      wide
    >
      <div className="modal-body">
        <p>
          Choose a Business Workspace JSON backup. Import creates new draft copies in your own
          workspace. Review each batch before saving.
        </p>
        <label>
          Backup file
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              void load(file);
            }}
          />
        </label>
        <p className="muted">
          Drafts keep record details and supported attachments. Account settings, payments, links,
          activity and check history stay outside the import. A conflicting appointment stops the
          whole batch.
        </p>
        {batch.length > 0 && (
          <>
            <h3>
              Records {cursor + 1}–{cursor + batch.length} of {records.length}
            </h3>
            <ul>
              {batch.map((record, index) => (
                <li key={index}>
                  {record.title} · {tools.find((tool) => tool.id === record.module)?.name}
                </li>
              ))}
            </ul>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(event) => setConfirmed(event.target.checked)}
              />{' '}
              Create {batch.length} new draft copies
            </label>
            <button className="primary" disabled={!confirmed || busy} onClick={importBatch}>
              {busy ? 'Importing…' : 'Import this batch'}
            </button>
          </>
        )}
        {records.length > 0 && cursor === records.length && (
          <p>All records from this file have been imported.</p>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
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
