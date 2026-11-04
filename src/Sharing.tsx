import { AttachmentField, AttachmentDownload } from './AttachmentField';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Copy,
  Link2,
  ShieldCheck,
  Printer,
  CheckCircle2,
  ArrowUpRight,
  LockKeyhole,
} from 'lucide-react';
import { api, date, download, money } from './lib';
import { Modal } from './ui';
import { DesignerCredit } from './DesignerCredit';
import { DocumentView } from './FinancialEditor';
import type { Item } from './types';
export const canShare = (id: string) =>
  [
    'proposals',
    'approvals',
    'invoices',
    'onboarding',
    'portfolio',
    'help',
    'catalogues',
    'testimonials',
    'uptime',
    'podcasts',
  ].includes(id);
export function ShareModal({ record, onClose }: { record: Item; onClose: () => void }) {
  const [meta, setMeta] = useState<{ active: boolean; expires?: number } | null>(null),
    [token, setToken] = useState(''),
    [days, setDays] = useState('7'),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [copied, setCopied] = useState(false),
    [revoke, setRevoke] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    api<{ active: boolean; expires?: number }>('/records/' + record.id + '/share')
      .then((m) => {
        if (live) setMeta(m);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [record.id]);
  const link = token ? `${location.origin}/#share=${token}` : '';
  async function create() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ token: string; expires: number }>(
        '/records/' + record.id + '/share',
        'POST',
        { version: record.version, days: Number(days), confirmed },
      );
      setToken(result.token);
      setMeta({ active: true, expires: result.expires });
      setCopied(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError('');
    try {
      await api('/records/' + record.id + '/share', 'DELETE', {});
      setMeta({ active: false });
      setToken('');
      setRevoke(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Share with confidence"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="modal-body">
        <div className="share-intro">
          <span className="tool-icon">
            <ShieldCheck size={25} />
          </span>
          <div>
            <h3>{record.title}</h3>
            <p className="muted small">
              A private link to one document. Your workspace stays private.
            </p>
          </div>
        </div>
        <div className="notice">
          Anyone with this link can view the shared content
          {['proposals', 'approvals', 'onboarding'].includes(record.module)
            ? ' and submit one response'
            : ''}
          . Only share details you intend the recipient to see. Editing the document invalidates its
          existing link.
        </div>
        {meta && (
          <p className="small muted">
            {meta.active
              ? `An active link expires ${date(new Date(meta.expires!).toISOString())}.`
              : 'No active sharing link.'}
          </p>
        )}
        {link && (
          <div className="share-result">
            <label htmlFor="share-link">
              Copy this link now
              <input
                id="share-link"
                ref={input}
                readOnly
                value={link}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <div className="actions">
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    setCopied(true);
                  } catch {
                    input.current?.focus();
                    input.current?.select();
                    setError('Select the link above and copy it manually.');
                  }
                }}
              >
                <Copy size={16} />
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <a className="button-link" href={link} target="_blank" rel="noopener noreferrer">
                Preview page
                <ArrowUpRight size={16} />
              </a>
            </div>
            <p className="small muted">
              The link is only shown after creation. Creating another link revokes the previous one.
            </p>
          </div>
        )}
        {revoke ? (
          <div className="notice">
            <h3>Revoke this link?</h3>
            <p>Existing recipients will lose access. You can create a new link later.</p>
            <div className="actions">
              <button disabled={busy} onClick={() => setRevoke(false)}>
                Keep link
              </button>
              <button className="warning" disabled={busy} onClick={() => void remove()}>
                Revoke access
              </button>
            </div>
          </div>
        ) : (
          <>
            <label>
              Link expires after
              <select value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="1">1 day</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
              </select>
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I confirm this content may be shared.
            </label>
            <div className="modal-actions">
              {meta?.active && (
                <button disabled={busy} onClick={() => setRevoke(true)}>
                  Revoke access
                </button>
              )}
              <button
                className="primary"
                disabled={!confirmed || busy || meta === null}
                onClick={() => void create()}
              >
                <Link2 size={16} />
                {busy
                  ? 'Creating…'
                  : meta?.active
                    ? 'Create replacement link'
                    : 'Create private link'}
              </button>
            </div>
          </>
        )}
        <p className="error" role="alert">
          {error}
        </p>
      </div>
    </Modal>
  );
}
type PublicData = {
  title: string;
  module: string;
  brand: string;
  version: number;
  expires: number;
  data: Record<string, string | boolean>;
  document?: Parameters<typeof DocumentView>[0]['document'];
  check?: { created: string; ok: boolean; status?: number; ms?: number } | null;
};
export function PublicPage({ token }: { token: string }) {
  const [page, setPage] = useState<PublicData | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [message, setMessage] = useState(''),
    [attachment, setAttachment] = useState(''),
    [answers, setAnswers] = useState<string[]>([]),
    [action, setAction] = useState('approve'),
    [done, setDone] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const questions =
    page?.module === 'onboarding'
      ? String(page.data.intakeChecklist || '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      : [];
  async function request(method = 'GET', data?: unknown) {
    const response = await fetch('/api/public', {
      method,
      headers: {
        'X-Workspace-Share': token,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'This page could not be opened.');
    return result;
  }
  useEffect(() => {
    let live = true;
    request()
      .then((result) => {
        if (live) {
          setPage(result);
          document.title = result.title + ' · ' + result.brand;
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex,nofollow';
    document.head.append(robots);
    return () => {
      live = false;
      robots.remove();
    };
  }, [token]);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (busy || !page) return;
    setError('');
    const invalid = Array.from(form.current?.elements || []).find(
      (el) =>
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && !el.validity.valid,
    ) as HTMLInputElement | undefined;
    if (invalid) {
      setError('Complete the required fields in the requested format.');
      invalid.focus();
      return;
    }
    setBusy(true);
    try {
      await request('POST', {
        version: page.version,
        name,
        email,
        message,
        action,
        attachment,
        answers,
      });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const interactive = page && ['proposals', 'approvals', 'onboarding'].includes(page.module);
  return (
    <main className="public-shell">
      <header className="public-top">
        <a href="/" className="public-logo">
          <span className="brandmark">bw</span>Business Workspace
        </a>
        <span className="public-security">
          <LockKeyhole size={14} />
          Private shared page
        </span>
      </header>
      {!page ? (
        <section className="public-empty">
          <h1>{error ? 'This link is unavailable' : 'Opening your document…'}</h1>
          <p className="muted">{error || 'Please wait a moment.'}</p>
          {error && (
            <a className="button-link" href="/">
              Visit Business Workspace
            </a>
          )}
        </section>
      ) : done ? (
        <section className="public-complete">
          <CheckCircle2 size={48} />
          <h1>Thank you, {name}.</h1>
          <p>Your response has been recorded for {page.brand}.</p>
          <p className="muted">This link has now closed to further responses.</p>
          <a className="button-link" href="/">
            Discover Business Workspace
            <ArrowUpRight size={16} />
          </a>
        </section>
      ) : (
        <div className="public-layout">
          <section className="public-content">
            {['proposals', 'invoices'].includes(page.module) ? (
              <DocumentView
                title={page.title}
                brand={page.brand}
                data={page.data}
                module={page.module}
                document={page.document}
              />
            ) : (
              <article className="public-article">
                {page.module === 'approvals' && (
                  <AttachmentDownload value={String(page.data.attachment || '')} />
                )}
                <span className="eyebrow">{page.brand}</span>
                <h1>{page.title}</h1>
                {page.module === 'onboarding' ? (
                  <>
                    <p className="muted">Tell us about the work you have in mind.</p>
                    <p className="preserve-lines">
                      {String(
                        page.data.publicNotes ||
                          'Complete the brief below and we will review your requirements.',
                      )}
                    </p>
                  </>
                ) : page.module === 'uptime' ? (
                  <>
                    <p>{String(page.data.url)}</p>
                    <div className={'status-hero ' + (page.check?.ok ? 'healthy' : '')}>
                      <span />
                      {page.check
                        ? page.check.ok
                          ? 'Last check successful'
                          : 'Last check unsuccessful'
                        : 'Awaiting first check'}
                    </div>
                    <p className="muted">
                      {page.check
                        ? `Checked ${new Date(page.check.created).toLocaleString()} · ${page.check.ms ?? '—'} ms`
                        : 'No check result is available.'}
                    </p>
                    <p className="small muted">Status from the latest stored check.</p>
                    {page.check && (
                      <button
                        type="button"
                        onClick={() => {
                          const status = page.check?.ok ? 'Operational' : 'Check failed';
                          const fill = page.check?.ok ? '#17633f' : '#96332d';
                          const timestamp =
                            new Date(page.check!.created)
                              .toISOString()
                              .slice(0, 16)
                              .replace('T', ' ') + ' UTC';
                          download(
                            'website-status.svg',
                            '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="52" viewBox="0 0 240 52"><rect width="240" height="52" rx="8" fill="' +
                              fill +
                              '"/><g fill="white" font-family="sans-serif"><text x="12" y="21" font-size="14">' +
                              status +
                              '</text><text x="12" y="39" font-size="11">Checked ' +
                              timestamp +
                              '</text></g></svg>',
                            'image/svg+xml',
                          );
                        }}
                      >
                        Download status badge
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <p className="preserve-lines">{String(page.data.notes || '')}</p>
                    {page.data.client && (
                      <p className="muted">
                        {page.module === 'testimonials' ? '— ' : ''}
                        {String(page.data.client)}
                      </p>
                    )}
                    {page.data.amount && (
                      <p className="public-price">{money(page.data.amount, page.data.currency)}</p>
                    )}
                    {page.data.url && (
                      <a
                        className="button-link"
                        href={String(page.data.url)}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        View linked work
                        <ArrowUpRight size={15} />
                      </a>
                    )}
                  </>
                )}
              </article>
            )}
            {page.module !== 'onboarding' && (
              <button className="print-document" onClick={() => window.print()}>
                <Printer size={16} />
                Print / save PDF
              </button>
            )}
          </section>
          {interactive && (
            <aside className="public-response">
              <span className="eyebrow">LET’S MOVE THINGS FORWARD</span>
              <h2>
                {page.module === 'onboarding'
                  ? 'Your project starts here.'
                  : 'Your feedback matters.'}
              </h2>
              <form noValidate onSubmit={send} ref={form}>
                <label>
                  Your name *
                  <input
                    required
                    maxLength={100}
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                {page.module === 'onboarding' ? (
                  <label>
                    Email address *
                    <input
                      type="email"
                      required
                      maxLength={254}
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                ) : (
                  <label>
                    Your decision
                    <select value={action} onChange={(e) => setAction(e.target.value)}>
                      <option value="approve">Approve this document</option>
                      <option value="changes">Request changes</option>
                    </select>
                  </label>
                )}
                <label>
                  {page.module === 'onboarding'
                    ? 'Project details *'
                    : action === 'changes'
                      ? 'Changes requested *'
                      : 'A note (optional)'}
                  <textarea
                    className="resize-none"
                    required={page.module === 'onboarding' || action === 'changes'}
                    rows={6}
                    maxLength={5000}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </label>
                <p className="small muted">
                  Your response will be shared with {page.brand}.{' '}
                  {page.module !== 'onboarding'
                    ? 'This records the link holder’s decision; it is not an identity-verified electronic signature.'
                    : ''}
                </p>
                {questions.map((question, index) => (
                  <label key={index}>
                    {question}
                    <input
                      required
                      maxLength={500}
                      value={answers[index] || ''}
                      onChange={(event) => {
                        const value = event.target.value;
                        setAnswers((previous) =>
                          Array.from({ length: questions.length }, (_, i) =>
                            i === index ? value : previous[i] || '',
                          ),
                        );
                      }}
                    />
                  </label>
                ))}
                {page.module === 'onboarding' && (
                  <AttachmentField value={attachment} onChange={setAttachment} disabled={busy} />
                )}
                <button type="submit" className="primary full" disabled={busy}>
                  {busy
                    ? 'Sending…'
                    : page.module === 'onboarding'
                      ? 'Send project brief'
                      : action === 'approve'
                        ? 'Record approval'
                        : 'Send requested changes'}
                </button>
              </form>
            </aside>
          )}
          <p className="error" role="alert">
            {error}
          </p>
        </div>
      )}
      <footer className="public-footer">
        <DesignerCredit />
        <a href="/">
          Run your own business with Workspace
          <ArrowUpRight size={14} />
        </a>
      </footer>
    </main>
  );
}
