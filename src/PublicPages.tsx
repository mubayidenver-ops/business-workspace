import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUpRight, CheckCircle2, Copy, Globe, ThumbsUp, Trash2 } from 'lucide-react';
import { Modal, SearchBox } from './ui';
import { api, date } from './lib';
import { DesignerCredit } from './DesignerCredit';
type Workspace = { id: string; name: string; role: string };

const kinds = [
  [
    'feedback',
    'Feedback board',
    'Clients submit and vote on requests. New requests arrive as Drafts.',
  ],
  [
    'testimonials',
    'Testimonial wall',
    'Shows consented Active testimonials and collects new ones as Drafts.',
  ],
  ['help', 'Help centre', 'Every Active help article, searchable by category.'],
  ['status', 'Status page', 'Live state and 24-hour uptime for Active uptime monitors.'],
  ['booking', 'Booking page', 'Guests pick a slot from your weekly availability.'],
] as const;
const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type Availability = {
  title: string;
  description: string;
  timezone: string;
  windows: { day: number; start: string; end: string }[];
  slotMinutes: number;
  bufferMinutes: number;
  noticeHours: number;
  horizonDays: number;
};
async function publicCall<T>(
  path: string,
  header: string,
  token: string,
  value?: unknown,
): Promise<T> {
  const response = await fetch('/api' + path, {
    method: value === undefined ? 'GET' : 'POST',
    headers: {
      [header]: token,
      ...(value === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.error || 'Something went wrong.'), {
      status: response.status,
    });
  return data;
}
const pageLink = (token: string) => `${location.origin}/#page=${token}`;
const slotLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

export function PublicPagesPanel({
  workspace,
  onClose,
}: {
  workspace: Workspace;
  onClose: () => void;
}) {
  const [pages, setPages] = useState<{ kind: string; token: string }[]>([]),
    [availability, setAvailability] = useState<Availability | null>(null),
    [editing, setEditing] = useState(false),
    [error, setError] = useState('');
  const admin = workspace.role === 'owner';
  const load = () =>
    Promise.all([api<typeof pages>('/pages'), api<Availability | null>('/availability')]).then(
      ([p, a]) => {
        setPages(p);
        setAvailability(a);
      },
      (e) => setError(e.message),
    );
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
  if (editing)
    return (
      <AvailabilityEditor
        value={availability}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          load();
        }}
      />
    );
  return (
    <Modal title="Public pages" onClose={onClose} wide>
      <div className="modal-body">
        <p className="muted">
          One public page of each type for {workspace.name}. Anyone with the link can view it.
          Replacing a link disables the old one.
        </p>
        <ul className="team-list">
          {kinds.map(([kind, label, detail]) => {
            const page = pages.find((p) => p.kind === kind);
            return (
              <li key={kind}>
                <span>
                  <strong>{label}</strong>
                  <small className="muted">{detail}</small>
                  {page && <code className="page-link">{pageLink(page.token)}</code>}
                  {kind === 'booking' && (
                    <small>
                      {availability
                        ? `${availability.windows.length} weekly windows · ${availability.slotMinutes}-minute slots · ${availability.timezone}`
                        : 'No weekly availability yet.'}{' '}
                      {admin && (
                        <button className="link-button" onClick={() => setEditing(true)}>
                          Edit availability
                        </button>
                      )}
                    </small>
                  )}
                </span>
                <span className="row-actions">
                  {page && (
                    <>
                      <button
                        className="icon-button"
                        aria-label={'Copy ' + label + ' link'}
                        onClick={() => navigator.clipboard.writeText(pageLink(page.token))}
                      >
                        <Copy size={16} />
                      </button>
                      <a
                        className="icon-button"
                        aria-label={'Open ' + label}
                        href={pageLink(page.token)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ArrowUpRight size={16} />
                      </a>
                    </>
                  )}
                  {admin && (
                    <button onClick={() => act(() => api('/pages', 'POST', { kind }))}>
                      <Globe size={16} /> {page ? 'New link' : 'Publish'}
                    </button>
                  )}
                  {admin && page && (
                    <button
                      className="icon-button"
                      aria-label={'Unpublish ' + label}
                      onClick={() => act(() => api('/pages/' + kind, 'DELETE'))}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="error" role="alert">
          {error}
        </p>
      </div>
    </Modal>
  );
}

function AvailabilityEditor({
  value,
  onClose,
  onSaved,
}: {
  value: Availability | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [a, setA] = useState<Availability>(
    value || {
      title: 'Consultation',
      description: '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      windows: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' })),
      slotMinutes: 30,
      bufferMinutes: 0,
      noticeHours: 12,
      horizonDays: 21,
    },
  );
  const [error, setError] = useState('');
  const set = (patch: Partial<Availability>) => setA({ ...a, ...patch });
  const num = (key: keyof Availability, label: string) => (
    <label>
      {label}
      <input
        type="number"
        min={0}
        value={a[key] as number}
        onChange={(e) => set({ [key]: Number(e.target.value) })}
      />
    </label>
  );
  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/availability', 'PUT', a);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Modal title="Weekly availability" onClose={onClose} wide>
      <form className="modal-body form-grid" onSubmit={save}>
        <label>
          Booking page title
          <input value={a.title} onChange={(e) => set({ title: e.target.value })} required />
        </label>
        <label>
          Time zone
          <input value={a.timezone} onChange={(e) => set({ timezone: e.target.value })} required />
        </label>
        <label className="span-2">
          Description
          <textarea
            rows={2}
            value={a.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        </label>
        {num('slotMinutes', 'Slot length (minutes)')}
        {num('bufferMinutes', 'Buffer between slots (minutes)')}
        {num('noticeHours', 'Minimum notice (hours)')}
        {num('horizonDays', 'Bookable days ahead')}
        <fieldset className="span-2">
          <legend>Weekly windows</legend>
          {a.windows.map((w, i) => (
            <div className="window-row" key={i}>
              <select
                aria-label="Day"
                value={w.day}
                onChange={(e) =>
                  set({
                    windows: a.windows.map((x, j) =>
                      j === i ? { ...x, day: Number(e.target.value) } : x,
                    ),
                  })
                }
              >
                {days.map((d, index) => (
                  <option key={d} value={index}>
                    {d}
                  </option>
                ))}
              </select>
              <input
                aria-label="From"
                type="time"
                value={w.start}
                onChange={(e) =>
                  set({
                    windows: a.windows.map((x, j) =>
                      j === i ? { ...x, start: e.target.value } : x,
                    ),
                  })
                }
              />
              <input
                aria-label="To"
                type="time"
                value={w.end}
                onChange={(e) =>
                  set({
                    windows: a.windows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)),
                  })
                }
              />
              <button
                type="button"
                className="icon-button"
                aria-label="Remove window"
                onClick={() => set({ windows: a.windows.filter((_, j) => j !== i) })}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              set({ windows: [...a.windows, { day: 1, start: '09:00', end: '17:00' }] })
            }
          >
            Add window
          </button>
        </fieldset>
        <div className="actions span-2">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Save availability
          </button>
        </div>
        <p className="error span-2" role="alert">
          {error}
        </p>
      </form>
    </Modal>
  );
}

function Shell({ brand, children }: { brand?: string; children: ReactNode }) {
  return (
    <main className="public-shell">
      <header className="public-top">
        <a href="/" className="public-logo">
          <span className="brandmark">bw</span>
          {brand || 'Business Workspace'}
        </a>
      </header>
      {children}
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
function Unavailable({ error }: { error: string }) {
  return (
    <section className="public-empty">
      <h1>{error ? 'This page is unavailable' : 'Opening…'}</h1>
      <p className="muted">{error || 'Please wait a moment.'}</p>
    </section>
  );
}
function SlotPicker({
  slots,
  value,
  onChange,
}: {
  slots: string[];
  value: string;
  onChange: (s: string) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const s of slots) map.set(dayLabel(s), [...(map.get(dayLabel(s)) || []), s]);
    return [...map];
  }, [slots]);
  if (!slots.length)
    return <p className="muted">No open times right now. Please check back later.</p>;
  return (
    <div className="slot-days">
      {grouped.map(([day, list]) => (
        <div key={day}>
          <strong>{day}</strong>
          <div className="slot-grid">
            {list.map((s) => (
              <button
                type="button"
                key={s}
                className={s === value ? 'primary' : ''}
                aria-pressed={s === value}
                onClick={() => onChange(s)}
              >
                {slotLabel(s)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

type PageData = {
  kind: string;
  brand: string;
  requests?: { id: string; title: string; status: string; votes: number; notes: string }[];
  testimonials?: { client: string; notes: string }[];
  articles?: { id: string; title: string; category: string; notes: string; updated: string }[];
  monitors?: {
    title: string;
    ok: boolean | null;
    checked: string | null;
    ms: number | null;
    uptime24h: number | null;
  }[];
  overall?: string;
  title?: string;
  description?: string;
  timezone?: string;
  slots?: string[];
};
function voterId() {
  let id = localStorage.getItem('bw-voter');
  if (!id) {
    id = [...crypto.getRandomValues(new Uint8Array(16))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    localStorage.setItem('bw-voter', id);
  }
  return id;
}

export function WorkspacePage({ token }: { token: string }) {
  const [page, setPage] = useState<PageData | null>(null),
    [error, setError] = useState(''),
    [done, setDone] = useState(''),
    [form, setForm] = useState({
      title: '',
      notes: '',
      name: '',
      email: '',
      consent: false,
      start: '',
    }),
    [query, setQuery] = useState(''),
    [voted, setVoted] = useState<string[]>([]);
  const call = <T,>(value?: unknown) => publicCall<T>('/page', 'X-Workspace-Page', token, value);
  const load = () => call<PageData>().then(setPage, (e) => setError(e.message));
  useEffect(() => {
    load();
  }, [token]);
  useEffect(() => {
    if (page)
      document.title = `${page.brand} · ${kinds.find((k) => k[0] === page.kind)?.[1] || ''}`;
  }, [page]);
  async function submit(e: FormEvent, value: Record<string, unknown>, message: string) {
    e.preventDefault();
    setError('');
    try {
      const r = await call<{ manageToken?: string }>(value);
      if (r.manageToken) location.assign('/#manage=' + r.manageToken + '&new=1');
      else setDone(message);
    } catch (err) {
      setError((err as Error).message);
      if ((err as { status?: number }).status === 409) load();
    }
  }
  if (!page)
    return (
      <Shell>
        <Unavailable error={error} />
      </Shell>
    );
  const field = (
    key: 'title' | 'notes' | 'name' | 'email',
    label: string,
    area = false,
    required = true,
  ) => (
    <label>
      {label}
      {area ? (
        <textarea
          rows={4}
          required={required}
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        />
      ) : (
        <input
          type={key === 'email' ? 'email' : 'text'}
          required={required}
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        />
      )}
    </label>
  );
  const thanks = done && (
    <section className="public-complete">
      <CheckCircle2 size={48} />
      <h1>Thank you.</h1>
      <p>{done}</p>
    </section>
  );
  const articles = (page.articles || []).filter((a) =>
    (a.title + a.notes + a.category).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Shell brand={page.brand}>
      {thanks || (
        <div className="public-layout">
          <section className="public-content">
            {page.kind === 'feedback' && (
              <>
                <h1>Feedback &amp; ideas</h1>
                <p className="muted">Vote for what matters to you, or suggest something new.</p>
                <ul className="board">
                  {page.requests!.map((r) => (
                    <li key={r.id} className="public-article">
                      <button
                        className={voted.includes(r.id) ? 'vote primary' : 'vote'}
                        aria-label={'Vote for ' + r.title}
                        disabled={voted.includes(r.id)}
                        onClick={async () => {
                          try {
                            await call({ action: 'vote', id: r.id, voter: voterId() });
                            setVoted([...voted, r.id]);
                            load();
                          } catch (err) {
                            setError((err as Error).message);
                          }
                        }}
                      >
                        <ThumbsUp size={16} /> {r.votes}
                      </button>
                      <div>
                        <strong>{r.title}</strong> <span className="chip">{r.status}</span>
                        {r.notes && <p className="muted">{r.notes}</p>}
                      </div>
                    </li>
                  ))}
                  {!page.requests!.length && (
                    <p className="muted">No requests yet. Be the first.</p>
                  )}
                </ul>
                <form
                  className="form-grid public-article"
                  onSubmit={(e) =>
                    submit(
                      e,
                      { action: 'submit', ...form },
                      'Your request was sent. It will appear on the board once reviewed.',
                    )
                  }
                >
                  <h2>Suggest something</h2>
                  {field('title', 'Request')}
                  {field('notes', 'Details', true)}
                  {field('name', 'Your name')}
                  <button className="primary" type="submit">
                    Send request
                  </button>
                </form>
              </>
            )}
            {page.kind === 'testimonials' && (
              <>
                <h1>What clients say</h1>
                {page.testimonials!.map((t, i) => (
                  <blockquote key={i} className="public-article">
                    <p>“{t.notes}”</p>
                    <cite>— {t.client}</cite>
                  </blockquote>
                ))}
                <form
                  className="form-grid public-article"
                  onSubmit={(e) =>
                    submit(
                      e,
                      { action: 'submit', ...form },
                      `Your testimonial was sent to ${page.brand}.`,
                    )
                  }
                >
                  <h2>Share your experience</h2>
                  {field('notes', 'Your testimonial', true)}
                  {field('name', 'Your name and company')}
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={form.consent}
                      onChange={(e) => setForm({ ...form, consent: e.target.checked })}
                    />
                    {page.brand} may publish this testimonial with my name.
                  </label>
                  <button className="primary" type="submit">
                    Send testimonial
                  </button>
                </form>
              </>
            )}
            {page.kind === 'help' && (
              <>
                <h1>Help centre</h1>
                <SearchBox value={query} onChange={setQuery} label="Search articles" />
                {[...new Set(articles.map((a) => a.category))].sort().map((category) => (
                  <section key={category}>
                    <h2>{category}</h2>
                    {articles
                      .filter((a) => a.category === category)
                      .map((a) => (
                        <details key={a.id} className="public-article">
                          <summary>{a.title}</summary>
                          <p className="prewrap">{a.notes}</p>
                          <small className="muted">Updated {date(a.updated)}</small>
                        </details>
                      ))}
                  </section>
                ))}
                {!articles.length && <p className="muted">No articles match.</p>}
              </>
            )}
            {page.kind === 'status' && (
              <>
                <h1 className={'status-' + page.overall}>
                  {page.overall === 'operational'
                    ? 'All systems operational'
                    : page.overall === 'degraded'
                      ? 'Some systems are down'
                      : 'Status not yet checked'}
                </h1>
                <ul className="board">
                  {page.monitors!.map((m) => (
                    <li key={m.title} className="public-article">
                      <span
                        className={'dot ' + (m.ok === null ? 'unknown' : m.ok ? 'up' : 'down')}
                      />
                      <div>
                        <strong>{m.title}</strong>
                        <p className="muted">
                          {m.ok === null ? 'Not checked yet' : m.ok ? 'Operational' : 'Down'}
                          {m.uptime24h !== null && ` · ${m.uptime24h}% uptime (24h)`}
                          {m.checked && ` · checked ${new Date(m.checked).toLocaleString()}`}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {page.kind === 'booking' && (
              <form
                className="form-grid"
                onSubmit={(e) => submit(e, { action: 'book', ...form }, '')}
              >
                <h1>{page.title}</h1>
                {page.description && <p className="muted">{page.description}</p>}
                <p className="muted small">
                  Times shown in your time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}
                  ).
                </p>
                <SlotPicker
                  slots={page.slots!}
                  value={form.start}
                  onChange={(start) => setForm({ ...form, start })}
                />
                {form.start && (
                  <>
                    {field('name', 'Your name')}
                    {field('email', 'Email')}
                    {field('notes', 'Anything we should know?', true, false)}
                    <button className="primary" type="submit">
                      Book {dayLabel(form.start)}, {slotLabel(form.start)}
                    </button>
                  </>
                )}
              </form>
            )}
            <p className="error" role="alert">
              {error}
            </p>
          </section>
        </div>
      )}
    </Shell>
  );
}

export function BookingManage({ token }: { token: string }) {
  const [booking, setBooking] = useState<{
      title: string;
      start: string;
      end: string;
      changeable: boolean;
      slots: string[];
    } | null>(null),
    [error, setError] = useState(''),
    [start, setStart] = useState(''),
    [message, setMessage] = useState(
      new URLSearchParams(location.hash.slice(1)).get('new')
        ? 'Your appointment is confirmed. Bookmark this page to reschedule or cancel.'
        : '',
    );
  const call = <T,>(value?: unknown) =>
    publicCall<T>('/booking-manage', 'X-Booking-Token', token, value);
  const load = () =>
    call<typeof booking>().then(setBooking, (e) => {
      setBooking(null);
      setError(e.message);
    });
  useEffect(() => {
    load();
  }, [token]);
  async function act(value: unknown, done: string) {
    setError('');
    try {
      await call(value);
      setMessage(done);
      setStart('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!booking)
    return (
      <Shell>
        <Unavailable error={message && error ? 'Your appointment was cancelled.' : error} />
      </Shell>
    );
  return (
    <Shell>
      <div className="public-layout">
        <section className="public-content">
          <h1>{booking.title}</h1>
          <p>
            <strong>{dayLabel(booking.start)}</strong>, {slotLabel(booking.start)}–
            {slotLabel(booking.end)}
          </p>
          {message && <p className="notice">{message}</p>}
          {booking.changeable ? (
            <>
              <h2>Reschedule</h2>
              <SlotPicker slots={booking.slots} value={start} onChange={setStart} />
              <div className="actions">
                {start && (
                  <button
                    className="primary"
                    onClick={() =>
                      act({ action: 'reschedule', start }, 'Your appointment was moved.')
                    }
                  >
                    Move to {dayLabel(start)}, {slotLabel(start)}
                  </button>
                )}
                <button
                  className="danger"
                  onClick={() =>
                    confirm('Cancel this appointment?') &&
                    act({ action: 'cancel' }, 'Your appointment was cancelled.')
                  }
                >
                  Cancel appointment
                </button>
              </div>
            </>
          ) : (
            <p className="muted">This appointment has started and can no longer be changed.</p>
          )}
          <p className="error" role="alert">
            {error}
          </p>
        </section>
      </div>
    </Shell>
  );
}
