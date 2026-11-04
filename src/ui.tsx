import { AttachmentField, AttachmentDownload } from './AttachmentField';
import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { X, Search, ArrowRight } from 'lucide-react';
import { api } from './lib';
import type { Item, Tool } from './types';
import { statuses } from '../shared/tools.mjs';
import { FinancialEditor } from './FinancialEditor';
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    const handler = (e: Event) => {
      e.preventDefault();
      close.current();
    };
    const d = ref.current;
    d?.addEventListener('cancel', handler);
    return () => {
      d?.removeEventListener('cancel', handler);
      d?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog className={wide ? 'wide' : ''} ref={ref} aria-labelledby="dialog-title">
      <header className="modal-head">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function SearchBox({
  value,
  onChange,
  label = 'Search tools, tasks, possibilities…',
}: {
  value: string;
  onChange: (s: string) => void;
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="search">
      <Search size={18} />
      <input
        ref={ref}
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          className="icon-button"
          aria-label="Clear search"
          onClick={() => {
            onChange('');
            ref.current?.focus();
          }}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
export function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-symbol">
        <ArrowRight size={24} />
      </div>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
export function RecordEditor({
  tool,
  item,
  template,
  readOnly = false,
  onClose,
  onSave,
}: {
  tool: Tool;
  item: Item | null;
  template?: Item;
  readOnly?: boolean;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  const initial = () => ({
    title: item?.title || (template ? template.title + ' (copy)' : ''),
    status: item?.status || 'Draft',
    data: {
      ...Object.fromEntries(
        tool.fields.map((f) => {
          let val =
            item?.data[f.key] ??
            (template && ['intakeChecklist', 'publicNotes'].includes(f.key)
              ? template.data[f.key]
              : undefined) ??
            (f.key === 'currency' ? 'USD' : f.type === 'checkbox' ? false : '');
          if (f.type === 'datetime-local' && typeof val === 'string' && val) {
            const d = new Date(val);
            val = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
          }
          return [f.key, val];
        }),
      ),
      ...(['proposals', 'invoices'].includes(tool.id)
        ? {
            lineItems:
              item?.data.lineItems ||
              JSON.stringify([
                {
                  description: item ? 'Services' : '',
                  quantity: 1,
                  rate: Number(item?.data.amount || 0),
                },
              ]),
            discountPercent: item?.data.discountPercent || '0',
            taxPercent: item?.data.taxPercent || '0',
          }
        : {}),
      ...(['approvals', 'store'].includes(tool.id)
        ? { attachment: item?.data.attachment || '' }
        : {}),
    } as Record<string, string | boolean>,
  });
  const [form, setForm] = useState(initial);
  const original = useRef(JSON.stringify(initial()));
  const requestKey = useRef(crypto.randomUUID());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = !readOnly && JSON.stringify(form) !== original.current;
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [dirty]);
  function close() {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || readOnly) return;
    setError('');
    const invalid = Array.from(formRef.current?.elements || []).find(
      (el) =>
        (el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          el instanceof HTMLSelectElement) &&
        !el.validity.valid,
    ) as HTMLInputElement | HTMLTextAreaElement | undefined;
    if (invalid) {
      setError(
        invalid.validity.valueMissing
          ? 'Complete the required fields.'
          : 'Check the highlighted field and use the requested format.',
      );
      invalid.setAttribute('aria-invalid', 'true');
      invalid.focus();
      return;
    }
    setBusy(true);
    try {
      const data = { ...form.data };
      for (const f of tool.fields)
        if (f.type === 'datetime-local' && data[f.key]) {
          const value = String(data[f.key]);
          if (item?.data[f.key] && value === initial().data[f.key]) {
            data[f.key] = item.data[f.key];
            continue;
          }
          const date = new Date(value);
          const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16);
          if (local !== value)
            throw new Error('That local time does not exist. Choose a different time.');
          data[f.key] = date.toISOString();
        }
      await api(item ? '/records/' + item.id : '/records', item ? 'PATCH' : 'POST', {
        ...form,
        data,
        module: tool.id,
        version: item?.version,
        requestKey: requestKey.current,
      });
      await onSave();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      formRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    } finally {
      setBusy(false);
    }
  }
  if (readOnly)
    return (
      <Modal title={item?.title || 'Read-only workspace'} onClose={onClose}>
        <div className="modal-body">
          {item ? (
            <dl>
              {tool.fields.map((field) => (
                <div key={field.key}>
                  <dt>{field.label}</dt>
                  <dd className="preserve-lines">{String(item.data[field.key] || '—')}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>
              Viewers can read existing records. Ask the workspace owner for editor access to create
              records.
            </p>
          )}
          {item?.data.attachment && <AttachmentDownload value={String(item.data.attachment)} />}
        </div>
      </Modal>
    );
  return (
    <Modal title={item ? 'Edit ' + tool.unit : 'New ' + tool.unit} onClose={close}>
      <form ref={formRef} noValidate onSubmit={save} className="modal-body">
        <p className="muted">
          {tool.name} <span className="required-note">* Required</span>
        </p>
        {discard ? (
          <div className="notice">
            <h3>Discard unsaved changes?</h3>
            <p>Your changes have not been saved.</p>
            <div className="actions">
              <button type="button" onClick={() => setDiscard(false)}>
                Keep editing
              </button>
              <button type="button" className="warning" onClick={onClose}>
                Discard changes
              </button>
            </div>
          </div>
        ) : (
          <>
            <label htmlFor="record-title">
              Title *
              <input
                id="record-title"
                name="title"
                autoFocus
                required
                maxLength={180}
                value={form.title}
                aria-describedby="record-error"
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <div className="form-grid">
              {tool.fields
                .filter((f) => !(f.key === 'amount' && ['proposals', 'invoices'].includes(tool.id)))
                .map((f) => (
                  <label
                    key={f.key}
                    className={
                      f.type === 'textarea'
                        ? 'span-two'
                        : f.type === 'checkbox'
                          ? 'check-label'
                          : ''
                    }
                    htmlFor={'field-' + f.key}
                  >
                    {f.label}
                    {f.required ? ' *' : ''}
                    {f.type === 'textarea' ? (
                      <textarea
                        className="resize-none"
                        id={'field-' + f.key}
                        style={{ resize: 'none' }}
                        required={f.required}
                        rows={6}
                        value={String(form.data[f.key])}
                        onChange={(e) =>
                          setForm({ ...form, data: { ...form.data, [f.key]: e.target.value } })
                        }
                        aria-describedby="record-error"
                      />
                    ) : (
                      <input
                        id={'field-' + f.key}
                        type={f.type}
                        required={f.required}
                        min={f.type === 'number' ? 0 : undefined}
                        step={f.type === 'number' ? 'any' : undefined}
                        checked={f.type === 'checkbox' ? !!form.data[f.key] : undefined}
                        value={f.type === 'checkbox' ? undefined : String(form.data[f.key])}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            data: {
                              ...form.data,
                              [f.key]: f.type === 'checkbox' ? e.target.checked : e.target.value,
                            },
                          })
                        }
                        aria-describedby="record-error"
                      />
                    )}
                  </label>
                ))}
            </div>
            {['proposals', 'invoices'].includes(tool.id) && (
              <FinancialEditor data={form.data} onChange={(data) => setForm({ ...form, data })} />
            )}
            {['approvals', 'store'].includes(tool.id) && (
              <AttachmentField
                value={String(form.data.attachment || '')}
                disabled={busy}
                onChange={(attachment) =>
                  setForm((previous) => ({ ...previous, data: { ...previous.data, attachment } }))
                }
              />
            )}
            {item?.data.clientResponse && (
              <section className="client-response-history">
                <span className="eyebrow">CLIENT RESPONSE</span>
                {(() => {
                  try {
                    const response = JSON.parse(String(item.data.clientResponse));
                    return (
                      <>
                        <h3>
                          {response.action === 'approve'
                            ? 'Approved'
                            : response.action === 'changes'
                              ? 'Changes requested'
                              : 'Project brief received'}
                        </h3>
                        <p className="small muted">
                          {response.name} · {new Date(response.created).toLocaleString()}
                        </p>
                        {response.email && <p className="small">{response.email}</p>}
                        <p className="preserve-lines">{response.message}</p>
                        {response.reviewedVersion && (
                          <p>Reviewed revision {response.reviewedVersion}</p>
                        )}
                        {Array.isArray(response.intake) && (
                          <dl>
                            {response.intake.map(
                              (entry: { question: string; answer: string }, index: number) => (
                                <div key={index}>
                                  <dt>{entry.question}</dt>
                                  <dd>{entry.answer}</dd>
                                </div>
                              ),
                            )}
                          </dl>
                        )}
                        {response.attachment && <AttachmentDownload value={response.attachment} />}
                      </>
                    );
                  } catch {
                    return <p>Response details are unavailable.</p>;
                  }
                })()}
              </section>
            )}
            <label htmlFor="record-status">
              Status
              <select
                id="record-status"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {statuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <p id="record-error" className="error" role="alert">
              {error}
            </p>
            <footer className="modal-actions">
              <button type="button" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button className="primary" type="submit" disabled={busy} aria-busy={busy}>
                {busy ? 'Saving…' : 'Save ' + tool.unit}
              </button>
            </footer>
          </>
        )}
      </form>
    </Modal>
  );
}
