import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ComponentType,
} from 'react';
import { createRoot } from 'react-dom/client';
import * as Icons from 'lucide-react';
import { tools as registry, groups } from '../shared/tools.mjs';
import { writeCSV } from '../shared/csv.mjs';
import type { Tool, Item, User, Check } from './types';
import { api, date, download, money, today } from './lib';
import { Empty, Modal, RecordEditor, SearchBox } from './ui';
import { Workbench } from './Workbench';
import './styles.css';
const tools = registry as Tool[];
const icons: Record<
  string,
  ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
> = {
  Activity: Icons.Activity,
  Link: Icons.Link,
  ScanEye: Icons.ScanEye,
  ShieldCheck: Icons.ShieldCheck,
  CircleCheck: Icons.CircleCheck,
  UserPlus: Icons.UserPlus,
  Receipt: Icons.Receipt,
  FileSignature: Icons.FileSignature,
  CalendarDays: Icons.CalendarDays,
  BriefcaseBusiness: Icons.BriefcaseBusiness,
  Quote: Icons.Quote,
  MessageSquare: Icons.MessageSquare,
  BookOpen: Icons.BookOpen,
  ListChecks: Icons.ListChecks,
  Table2: Icons.Table2,
  FileSpreadsheet: Icons.FileSpreadsheet,
  Files: Icons.Files,
  Image: Icons.Image,
  LayoutGrid: Icons.LayoutGrid,
  Palette: Icons.Palette,
  Captions: Icons.Captions,
  Scissors: Icons.Scissors,
  Mic: Icons.Mic,
  Sparkles: Icons.Sparkles,
  GraduationCap: Icons.GraduationCap,
  Languages: Icons.Languages,
  PanelsTopLeft: Icons.PanelsTopLeft,
  ShoppingBag: Icons.ShoppingBag,
  KeyRound: Icons.KeyRound,
  Wrench: Icons.Wrench,
  Globe2: Icons.Globe2,
  Users: Icons.Users,
  FolderOpen: Icons.FolderOpen,
  WandSparkles: Icons.WandSparkles,
};
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const Component = icons[name] || Icons.Box;
  return <Component size={size} strokeWidth={1.7} />;
}
const groupIcons: Record<string, string> = {
  Websites: 'Globe2',
  Clients: 'Users',
  Operations: 'BriefcaseBusiness',
  Files: 'FolderOpen',
  Content: 'WandSparkles',
  Learning: 'GraduationCap',
  Commerce: 'ShoppingBag',
};
const getTool = (id: string) => tools.find((t) => t.id === id)!;
type State = { user: User; records: Item[]; checks: Check[] };
function Auth({ onAuth }: { onAuth: () => Promise<void> }) {
  const [mode, setMode] = useState('register'),
    [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const ref = useRef<HTMLFormElement>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!email.includes('@') || password.length < 10 || (mode === 'register' && !name.trim())) {
      setError(
        'Enter your email, a password of at least 10 characters, and a workspace name if registering.',
      );
      ref.current?.querySelector<HTMLInputElement>('input:invalid')?.focus();
      return;
    }
    setBusy(true);
    try {
      await api('/auth', 'POST', { mode, name, email, password });
      await onAuth();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <a href="/" className="brand">
          <span className="brandmark">
            <Icons.Boxes size={27} />
          </span>
          Business Workspace
        </a>
        <div className="auth-pitch">
          <span className="eyebrow">LESS SWITCHING. MORE DOING.</span>
          <h1>
            Your business.
            <br />
            All together.
          </h1>
          <p>A home for your clients, your ideas, and the work that moves you forward.</p>
          <div className="orbit-tools">
            {['Clients', 'Content', 'Files', 'Websites'].map((g) => (
              <div key={g}>
                <Icon name={groupIcons[g]} size={24} />
                <span>{g}</span>
              </div>
            ))}
          </div>
          <div className="auth-proof">
            <span className="tiny-grid">✦</span>
            <span>
              30 tools. One connected workspace.
              <br />
              <small>Built for independent businesses everywhere.</small>
            </span>
          </div>
        </div>
        <small>Development release · Your data is stored on this server.</small>
      </section>
      <section className="auth-form">
        <div className="auth-form-inner">
          <span className="eyebrow">LET’S MAKE ROOM FOR GOOD WORK</span>
          <h2>{mode === 'register' ? 'Start your workspace.' : 'Welcome back.'}</h2>
          <p className="muted">
            {mode === 'register'
              ? 'A little more organised. A lot more possible.'
              : 'Your tools and projects are waiting for you.'}
          </p>
          <form noValidate ref={ref} onSubmit={submit}>
            {mode === 'register' && (
              <label htmlFor="workspace-name">
                Workspace name
                <input
                  id="workspace-name"
                  autoComplete="organization"
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            <label htmlFor="email">
              Email address
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-describedby="auth-error"
              />
            </label>
            <label htmlFor="password">
              Password
              <span className="password-wrap">
                <input
                  id="password"
                  type={show ? 'text' : 'password'}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  minLength={10}
                  maxLength={128}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-describedby="auth-error"
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={show ? 'Hide password' : 'Show password'}
                  aria-pressed={show}
                  onClick={() => setShow(!show)}
                >
                  {show ? <Icons.EyeOff size={18} /> : <Icons.Eye size={18} />}
                </button>
              </span>
            </label>
            <small className="muted">At least 10 characters. Use a unique password.</small>
            <p className="error" id="auth-error" role="alert">
              {error}
            </p>
            <button type="submit" className="primary full" disabled={busy} aria-busy={busy}>
              {busy ? 'Opening workspace…' : mode === 'register' ? 'Create workspace' : 'Sign in'}
              <Icons.ArrowRight size={18} />
            </button>
          </form>
          <p className="auth-switch">
            {mode === 'register' ? 'Already have a workspace?' : 'New here?'}{' '}
            <button
              className="link-button"
              onClick={() => {
                setMode(mode === 'register' ? 'login' : 'register');
                setError('');
              }}
            >
              {mode === 'register' ? 'Sign in' : 'Create workspace'}
            </button>
          </p>
          <div className="auth-note">
            <Icons.LockKeyhole size={17} />
            <span>No credit card needed. Paid services are not enabled in this release.</span>
          </div>
        </div>
      </section>
    </main>
  );
}
function App() {
  const [state, setState] = useState<State | null>(null),
    [initial, setInitial] = useState(true),
    [loadError, setLoadError] = useState('');
  const [params, setParams] = useState(() => new URLSearchParams(location.search));
  const view = params.get('view') || 'overview',
    category = params.get('group') || 'All tools',
    query = params.get('q') || '';
  const [mobile, setMobile] = useState(false),
    [editing, setEditing] = useState<{ tool: Tool; item: Item | null } | null>(null),
    [archive, setArchive] = useState<Item | null>(null),
    [archiveBusy, setArchiveBusy] = useState(false),
    [archiveError, setArchiveError] = useState(''),
    [notice, setNotice] = useState(''),
    [panel, setPanel] = useState(''),
    [run, setRun] = useState(''),
    [checkResult, setCheckResult] = useState<{ title: string; value: Check['result'] } | null>(
      null,
    ),
    [print, setPrint] = useState<Item[] | null>(null);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem('bw-favorites') || '["proposals","projects","cleanup","uptime"]',
      );
    } catch {
      return [];
    }
  });
  const [recordQuery, setRecordQuery] = useState(''),
    [showArchived, setShowArchived] = useState(false),
    [page, setPage] = useState(1),
    [refreshing, setRefreshing] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const refresh = async () => {
    const data = await api<State>('/state');
    setState(data);
    setLoadError('');
  };
  useEffect(() => {
    refresh()
      .catch((e) => {
        if (e.status !== 401) setLoadError(e.message);
      })
      .finally(() => setInitial(false));
    const pop = () => setParams(new URLSearchParams(location.search));
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    localStorage.setItem('bw-favorites', JSON.stringify(favorites));
  }, [favorites]);
  useEffect(() => {
    setPage(1);
    setRecordQuery('');
    setShowArchived(false);
    document.title =
      (getTool(view)?.name || (view === 'tools' ? 'All tools' : 'Overview')) +
      ' · Business Workspace';
  }, [view]);
  useEffect(() => {
    if (!print) return;
    const id = setTimeout(() => window.print(), 100);
    return () => clearTimeout(id);
  }, [print]);
  useEffect(() => {
    if (!state) return;
    const timer = setInterval(() => refresh().catch(() => {}), 60000);
    return () => clearInterval(timer);
  }, [!!state]);
  function navigate(next: string, group = 'All tools', q = '') {
    const p = new URLSearchParams();
    if (next !== 'overview') p.set('view', next);
    if (group !== 'All tools') p.set('group', group);
    if (q) p.set('q', q);
    history.pushState({}, '', location.pathname + (p.size ? '?' + p : ''));
    setParams(p);
    setMobile(false);
    setPanel('');
    window.scrollTo({ top: 0 });
    setTimeout(() => mainRef.current?.focus(), 0);
  }
  function search(value: string) {
    const p = new URLSearchParams(params);
    p.set('view', 'tools');
    if (value) p.set('q', value);
    else p.delete('q');
    history.replaceState({}, '', location.pathname + '?' + p);
    setParams(p);
  }
  function star(id: string) {
    setFavorites((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  }
  async function saved() {
    try {
      await refresh();
      setNotice('Saved to your workspace.');
    } catch {
      setNotice('Saved on the server. Refresh this page to update the list.');
    }
  }
  async function toggleArchive() {
    if (!archive || archiveBusy) return;
    setArchiveBusy(true);
    setArchiveError('');
    try {
      await api('/records/' + archive.id, 'PATCH', {
        version: archive.version,
        archived: !archive.archived,
      });
      await refresh();
      setNotice(
        archive.archived ? 'Record restored.' : 'Record archived. Find it in the archive view.',
      );
      setArchive(null);
    } catch (e) {
      setArchiveError((e as Error).message);
    } finally {
      setArchiveBusy(false);
    }
  }
  async function runCheck(item: Item) {
    if (run) return;
    setRun(item.id);
    try {
      const value = await api<Check['result']>('/records/' + item.id + '/check', 'POST', {});
      setCheckResult({ title: item.title, value });
      await refresh();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setRun('');
    }
  }
  if (initial)
    return (
      <div className="loading-screen">
        <Icons.Boxes size={38} />
        <p>Opening your workspace…</p>
      </div>
    );
  if (!state)
    return (
      <>
        {loadError && (
          <div role="alert" className="global-error">
            {loadError}
            <button
              onClick={() => {
                setInitial(true);
                refresh()
                  .catch((e) => setLoadError(e.message))
                  .finally(() => setInitial(false));
              }}
            >
              Try again
            </button>
          </div>
        )}
        <Auth onAuth={refresh} />
      </>
    );
  const active = state.records.filter((r) => !r.archived);
  const due = active.filter(
    (r) =>
      r.data.due && String(r.data.due) <= today() && !['Completed', 'Cancelled'].includes(r.status),
  );
  const open = active.filter((r) => !['Completed', 'Cancelled'].includes(r.status));
  const currentTool = getTool(view);
  const moduleRecords = state.records.filter(
    (r) =>
      r.module === view &&
      r.archived === showArchived &&
      (r.title + ' ' + Object.values(r.data).join(' '))
        .toLowerCase()
        .includes(recordQuery.toLowerCase()),
  );
  const totalPages = Math.max(1, Math.ceil(moduleRecords.length / 10));
  const pageIndex = Math.min(page, totalPages);
  const filtered = tools.filter(
    (t) =>
      (category === 'All tools' || t.group === category) &&
      (t.name + ' ' + t.description + ' ' + t.group).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="app-shell">
        <aside className={mobile ? 'sidebar open' : 'sidebar'}>
          <a
            className="brand"
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate('overview');
            }}
          >
            <span className="brandmark">
              <Icons.Boxes size={25} />
            </span>
            <span>
              business<span className="brand-second">workspace</span>
            </span>
          </a>
          <button className="workspace-switch" onClick={() => setPanel('settings')}>
            <span className="avatar">{state.user.name.slice(0, 1).toUpperCase()}</span>
            <span>
              {state.user.name}
              <small>Personal workspace</small>
            </span>
            <Icons.ChevronsUpDown size={15} />
          </button>
          <nav aria-label="Main navigation">
            <span className="nav-label">WORKSPACE</span>
            <button
              className={view === 'overview' ? 'nav-item selected' : 'nav-item'}
              onClick={() => navigate('overview')}
            >
              <Icons.LayoutDashboard size={19} />
              Overview
            </button>
            <button
              className={
                view === 'tools' && category === 'All tools' ? 'nav-item selected' : 'nav-item'
              }
              onClick={() => navigate('tools')}
            >
              <Icons.Grid2X2 size={19} />
              All tools<span className="nav-count">30</span>
            </button>
            <span className="nav-label section-label">YOUR TOOLKIT</span>
            {groups.map((g) => (
              <button
                key={g}
                className={
                  category === g || currentTool?.group === g ? 'nav-item selected' : 'nav-item'
                }
                onClick={() => navigate('tools', g)}
              >
                <Icon name={groupIcons[g]} size={19} />
                {g}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="build-note">
              <span className="badge dot">Development release</span>
              <p>
                A little less busy.
                <br />A little more business.
              </p>
              <button onClick={() => setPanel('release')}>
                What’s ready <Icons.ArrowUpRight size={14} />
              </button>
            </div>
            <button className="nav-item" onClick={() => setPanel('settings')}>
              <Icons.Settings2 size={19} />
              Workspace settings
            </button>
            <button className="profile" onClick={() => setPanel('settings')}>
              <span className="avatar light">{state.user.email.slice(0, 2).toUpperCase()}</span>
              <span>
                {state.user.name}
                <small>{state.user.email}</small>
              </span>
              <Icons.MoreHorizontal size={18} />
            </button>
          </div>
        </aside>
        {mobile && (
          <button
            aria-label="Close navigation"
            className="nav-scrim"
            onClick={() => setMobile(false)}
          />
        )}
        <div className="main-shell">
          <header className="topbar">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Icons.Menu size={22} />
            </button>
            <div className="breadcrumb">
              Workspace <Icons.ChevronRight size={14} />
              <strong>
                {currentTool?.name ||
                  (view === 'tools'
                    ? category === 'All tools'
                      ? 'All tools'
                      : category
                    : 'Overview')}
              </strong>
            </div>
            <div className="top-actions">
              <SearchBox value={query} onChange={search} />
              <button
                className="notification-button icon-button"
                aria-label={`Due reminders, ${due.length} items`}
                onClick={() => setPanel('notifications')}
              >
                <Icons.Bell size={20} />
                {due.length > 0 && <span className="notification-dot" />}
              </button>
              <button
                className="avatar top-avatar"
                aria-label="Workspace settings"
                onClick={() => setPanel('settings')}
              >
                {state.user.name.slice(0, 1).toUpperCase()}
              </button>
            </div>
          </header>
          <main id="main" className="main-content" ref={mainRef} tabIndex={-1}>
            {notice && (
              <div role="status" className="status-banner">
                <Icons.CheckCircle2 size={18} />
                <span>{notice}</span>
                <button
                  className="icon-button"
                  aria-label="Dismiss message"
                  onClick={() => setNotice('')}
                >
                  <Icons.X size={16} />
                </button>
              </div>
            )}
            {view === 'overview' ? (
              <>
                <div className="page-heading">
                  <div>
                    <p className="eyebrow">YOUR DAILY STARTING POINT</p>
                    <h1>Good work starts here.</h1>
                    <p className="muted">A little clarity for everything you’re building.</p>
                  </div>
                  <button className="primary" onClick={() => navigate('tools')}>
                    <Icons.Plus size={17} />
                    Explore your tools
                  </button>
                </div>
                <div className="dashboard-top">
                  <section className="welcome-card">
                    <div className="welcome-content">
                      <span className="welcome-label">
                        <span /> ONE CONNECTED WORKSPACE
                      </span>
                      <h2>
                        Big ambitions.
                        <br />
                        Less juggling.
                      </h2>
                      <p>
                        Your clients, content, and everyday tasks.
                        <br />
                        Finally pulling in the same direction.
                      </p>
                      <button onClick={() => navigate('tools')}>
                        Find your next tool <Icons.ArrowRight size={17} />
                      </button>
                    </div>
                    <div className="tool-art" aria-hidden="true">
                      <div className="art-orbit" />
                      <div className="art-tile art-one">
                        <Icons.FileSignature size={29} />
                        <span>Create</span>
                      </div>
                      <div className="art-tile art-two">
                        <Icons.Users size={28} />
                        <span>Connect</span>
                      </div>
                      <div className="art-tile art-three">
                        <Icons.CheckCheck size={31} />
                        <span>Deliver</span>
                      </div>
                      <div className="art-spark">✳</div>
                    </div>
                  </section>
                  <section className="momentum-card">
                    <span className="eyebrow">YOUR WORKSPACE AT A GLANCE</span>
                    <div className="momentum-row">
                      <span className="metric-icon">
                        <Icons.Layers3 size={19} />
                      </span>
                      <div>
                        <strong>{active.length}</strong>
                        <span>Saved records</span>
                      </div>
                      <Icons.ArrowUpRight size={17} />
                    </div>
                    <div className="momentum-row">
                      <span className="metric-icon peach">
                        <Icons.CircleDashed size={19} />
                      </span>
                      <div>
                        <strong>{open.length}</strong>
                        <span>Open items</span>
                      </div>
                      <Icons.ArrowUpRight size={17} />
                    </div>
                    <button
                      className="momentum-row reminder-row"
                      onClick={() => setPanel('notifications')}
                    >
                      <span className="metric-icon lilac">
                        <Icons.CalendarClock size={19} />
                      </span>
                      <div>
                        <strong>{due.length}</strong>
                        <span>Due reminders</span>
                      </div>
                      <Icons.ArrowRight size={17} />
                    </button>
                  </section>
                </div>
                <section className="section">
                  <div className="section-heading">
                    <div>
                      <h2>
                        Your go-to tools <span className="subtle-count">{favorites.length}</span>
                      </h2>
                      <p className="muted">Keep your everyday essentials within reach.</p>
                    </div>
                    <button className="text-button" onClick={() => navigate('tools')}>
                      View all tools <Icons.ArrowRight size={16} />
                    </button>
                  </div>
                  <div className="tool-grid favorites">
                    {tools
                      .filter((t) => favorites.includes(t.id))
                      .map((t) => (
                        <ToolCard
                          key={t.id}
                          tool={t}
                          starred={true}
                          onStar={() => star(t.id)}
                          onOpen={() => navigate(t.id)}
                          count={active.filter((r) => r.module === t.id).length}
                        />
                      ))}
                  </div>
                  {!favorites.length && (
                    <Empty
                      title="Make room for your favourites"
                      detail="Star a tool in the library to keep it here."
                      action={<button onClick={() => navigate('tools')}>Find a tool</button>}
                    />
                  )}
                </section>
                <div className="dashboard-bottom">
                  <section className="recent-panel">
                    <div className="section-heading">
                      <h2>Recently worked on</h2>
                      <span className="small muted">Saved on this server</span>
                    </div>
                    {active.length ? (
                      <div className="recent-list">
                        {active.slice(0, 5).map((r) => (
                          <button
                            key={r.id}
                            className="recent-item"
                            onClick={() => navigate(r.module)}
                          >
                            <span className={'tool-icon ' + getTool(r.module).group.toLowerCase()}>
                              <Icon name={getTool(r.module).icon} />
                            </span>
                            <span>
                              <strong>{r.title}</strong>
                              <small>
                                {getTool(r.module).name} · {date(r.updated)}
                              </small>
                            </span>
                            <span className="badge">{r.status}</span>
                            <Icons.ChevronRight size={17} />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        title="Your next project belongs here"
                        detail="Create a brief, plan a project, or prepare a proposal. Your recent work will appear here."
                        action={
                          <button
                            onClick={() => setEditing({ tool: getTool('projects'), item: null })}
                          >
                            <Icons.Plus size={16} />
                            Create a project
                          </button>
                        }
                      />
                    )}
                  </section>
                  <section className="workflow-card">
                    <div className="workflow-icon">
                      <Icons.Route size={24} />
                    </div>
                    <span className="eyebrow">A BETTER WAY TO WORK</span>
                    <h2>
                      From hello
                      <br />
                      to a job well done.
                    </h2>
                    <p>Keep every step of your client work together.</p>
                    <div className="workflow-steps">
                      {[
                        ['onboarding', 'Collect a brief'],
                        ['proposals', 'Make a proposal'],
                        ['approvals', 'Get approval'],
                      ].map(([id, label], i) => (
                        <button key={id} onClick={() => navigate(id)}>
                          <span>{i + 1}</span>
                          {label}
                          <Icons.ArrowUpRight size={14} />
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              </>
            ) : view === 'tools' ? (
              <>
                <div className="page-heading">
                  <div>
                    <p className="eyebrow">BUILT TO WORK TOGETHER</p>
                    <h1>
                      {category === 'All tools'
                        ? 'A place for every possibility.'
                        : category + ' tools.'}
                    </h1>
                    <p className="muted">30 ways to make your working day a little easier.</p>
                  </div>
                  <span className="library-count">{filtered.length} tools</span>
                </div>
                <div className="category-tabs" aria-label="Tool categories">
                  {['All tools', ...groups].map((g) => (
                    <button
                      key={g}
                      aria-pressed={category === g}
                      className={category === g ? 'active' : ''}
                      onClick={() => navigate('tools', g, query)}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                <div className="library-search">
                  <SearchBox value={query} onChange={search} label="Find a tool by name or task" />
                  {query && <span className="muted small">{filtered.length} matching tools</span>}
                </div>
                {filtered.length ? (
                  <div className="tool-grid library">
                    {filtered.map((t) => (
                      <ToolCard
                        key={t.id}
                        tool={t}
                        starred={favorites.includes(t.id)}
                        onStar={() => star(t.id)}
                        onOpen={() => navigate(t.id)}
                        count={active.filter((r) => r.module === t.id).length}
                      />
                    ))}
                  </div>
                ) : (
                  <Empty
                    title="No tools match that search"
                    detail="Try another name or choose a different category."
                    action={<button onClick={() => navigate('tools')}>Clear filters</button>}
                  />
                )}
              </>
            ) : currentTool ? (
              <>
                <button className="back-link" onClick={() => navigate('tools', currentTool.group)}>
                  <Icons.ArrowLeft size={16} /> {currentTool.group}
                </button>
                <div className="page-heading">
                  <div>
                    <span className={'tool-icon large ' + currentTool.group.toLowerCase()}>
                      <Icon name={currentTool.icon} size={26} />
                    </span>
                    <h1>{currentTool.name}</h1>
                    <p className="muted">{currentTool.description}</p>
                  </div>
                  <button
                    className="primary"
                    onClick={() => setEditing({ tool: currentTool, item: null })}
                  >
                    <Icons.Plus size={17} />
                    New {currentTool.unit}
                  </button>
                </div>
                {currentTool.integration && (
                  <div className="integration-note">
                    <Icons.Info size={18} />
                    <span>{currentTool.integration}</span>
                  </div>
                )}
                {currentTool.utility && <Workbench key={currentTool.id} tool={currentTool} />}
                <section className="records-panel">
                  <div className="section-heading">
                    <div>
                      <h2>
                        Saved {currentTool.unit}s{' '}
                        <span className="subtle-count">{moduleRecords.length}</span>
                      </h2>
                      <p className="muted">
                        Keep the details together. Pick up where you left off.
                      </p>
                    </div>
                    <div className="actions">
                      <button
                        disabled={!moduleRecords.length}
                        onClick={() =>
                          download(
                            currentTool.id + '.csv',
                            writeCSV([
                              ['Title', 'Status', ...currentTool.fields.map((f) => f.label)],
                              ...moduleRecords.map((r) => [
                                r.title,
                                r.status,
                                ...currentTool.fields.map((f) => String(r.data[f.key] ?? '')),
                              ]),
                            ]),
                            'text/csv',
                          )
                        }
                      >
                        <Icons.Download size={16} />
                        Export
                      </button>
                      {[
                        'proposals',
                        'invoices',
                        'catalogues',
                        'portfolio',
                        'podcasts',
                        'help',
                      ].includes(view) && (
                        <button
                          disabled={!moduleRecords.length}
                          onClick={() => setPrint(moduleRecords)}
                        >
                          <Icons.Printer size={16} />
                          Print / PDF
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="records-toolbar">
                    <SearchBox
                      value={recordQuery}
                      onChange={(s) => {
                        setRecordQuery(s);
                        setPage(1);
                      }}
                      label="Search saved records"
                    />
                    <label className="inline-check">
                      <input
                        type="checkbox"
                        checked={showArchived}
                        onChange={(e) => {
                          setShowArchived(e.target.checked);
                          setPage(1);
                        }}
                      />
                      Archived
                    </label>
                    <button
                      className="icon-button"
                      aria-label="Refresh records"
                      disabled={refreshing}
                      onClick={async () => {
                        setRefreshing(true);
                        try {
                          await refresh();
                        } catch (e) {
                          setNotice((e as Error).message);
                        } finally {
                          setRefreshing(false);
                        }
                      }}
                    >
                      <Icons.RefreshCw size={17} className={refreshing ? 'spinning' : ''} />
                    </button>
                  </div>
                  {moduleRecords.length ? (
                    <>
                      <div className="table-scroll">
                        <table className="records-table">
                          <caption className="sr-only">Saved {currentTool.name} records</caption>
                          <thead>
                            <tr>
                              <th scope="col">Name</th>
                              <th scope="col">Status</th>
                              <th scope="col">Details</th>
                              <th scope="col">Updated</th>
                              <th scope="col">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {moduleRecords.slice((pageIndex - 1) * 10, pageIndex * 10).map((r) => (
                              <tr key={r.id}>
                                <td>
                                  <button
                                    className="record-title"
                                    onClick={() => setEditing({ tool: currentTool, item: r })}
                                  >
                                    {r.title}
                                  </button>
                                  <span className="record-client">
                                    {String(r.data.client || r.data.url || '')}
                                  </span>
                                </td>
                                <td>
                                  <span
                                    className={
                                      'badge ' +
                                      (r.status === 'Completed'
                                        ? 'success'
                                        : r.status === 'In review'
                                          ? 'review'
                                          : '')
                                    }
                                  >
                                    {r.status}
                                  </span>
                                </td>
                                <td>
                                  <RecordSummary item={r} />
                                </td>
                                <td className="muted small">{date(r.updated)}</td>
                                <td>
                                  <div className="row-actions">
                                    <button
                                      className="icon-button"
                                      aria-label={'Edit ' + r.title}
                                      onClick={() => setEditing({ tool: currentTool, item: r })}
                                    >
                                      <Icons.Pencil size={16} />
                                    </button>
                                    {['uptime', 'links', 'changes', 'expiry'].includes(view) &&
                                      !r.archived && (
                                        <button disabled={!!run} onClick={() => void runCheck(r)}>
                                          {run === r.id ? 'Checking…' : 'Check now'}
                                        </button>
                                      )}
                                    {view === 'feedback' && (
                                      <button
                                        onClick={async () => {
                                          try {
                                            await api('/records/' + r.id + '/vote', 'POST', {});
                                            await saved();
                                          } catch (e) {
                                            setNotice((e as Error).message);
                                          }
                                        }}
                                      >
                                        <Icons.ThumbsUp size={15} />
                                        {r.votes}
                                      </button>
                                    )}
                                    <button
                                      className="icon-button"
                                      aria-label={(r.archived ? 'Restore ' : 'Archive ') + r.title}
                                      onClick={() => {
                                        setArchive(r);
                                        setArchiveError('');
                                      }}
                                    >
                                      {r.archived ? (
                                        <Icons.ArchiveRestore size={16} />
                                      ) : (
                                        <Icons.Archive size={16} />
                                      )}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="pagination">
                        <span>
                          {(pageIndex - 1) * 10 + 1}–
                          {Math.min(pageIndex * 10, moduleRecords.length)} of {moduleRecords.length}
                        </span>
                        <div className="actions">
                          <button disabled={pageIndex === 1} onClick={() => setPage(pageIndex - 1)}>
                            Previous
                          </button>
                          <span>
                            Page {pageIndex} of {totalPages}
                          </span>
                          <button
                            disabled={pageIndex === totalPages}
                            onClick={() => setPage(pageIndex + 1)}
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <Empty
                      title={
                        recordQuery
                          ? 'No matching records'
                          : showArchived
                            ? 'Your archive is empty'
                            : 'Your first ' + currentTool.unit + ' starts here'
                      }
                      detail={
                        recordQuery
                          ? 'Try another search or clear the search field.'
                          : 'Add the details now and come back whenever you need them.'
                      }
                      action={
                        !recordQuery && !showArchived ? (
                          <button onClick={() => setEditing({ tool: currentTool, item: null })}>
                            <Icons.Plus size={16} />
                            New {currentTool.unit}
                          </button>
                        ) : undefined
                      }
                    />
                  )}
                </section>
                {['uptime', 'changes', 'expiry', 'links'].includes(view) && (
                  <section className="records-panel section">
                    <div className="section-heading">
                      <h2>Recent check results</h2>
                      <span className="small muted">Latest 200 checks across the workspace</span>
                    </div>
                    {state.checks
                      .filter((c) => active.some((r) => r.id === c.record_id && r.module === view))
                      .slice(0, 10)
                      .map((c) => (
                        <button
                          className="check-item"
                          key={c.id}
                          onClick={() =>
                            setCheckResult({
                              title:
                                active.find((r) => r.id === c.record_id)?.title || 'Website check',
                              value: c.result,
                            })
                          }
                        >
                          <span className={'badge ' + (c.result.ok ? 'success' : '')}>
                            {c.result.error ? 'Failed' : c.result.status}
                          </span>
                          <strong>{active.find((r) => r.id === c.record_id)?.title}</strong>
                          <span className="muted small">
                            {c.result.changed ? 'Change detected · ' : ''}
                            {date(c.created)} · {c.result.ms ?? '—'} ms
                          </span>
                          <Icons.ChevronRight size={16} />
                        </button>
                      ))}
                    {!state.checks.some((c) =>
                      active.some((r) => r.id === c.record_id && r.module === view),
                    ) && <p className="muted">Run your first check to see real results here.</p>}
                  </section>
                )}
              </>
            ) : (
              <Empty
                title="Tool not found"
                detail="Open the tool library to choose a workspace."
                action={<button onClick={() => navigate('tools')}>All tools</button>}
              />
            )}
            <footer className="page-footer">
              <span>
                <Icons.Boxes size={15} />
                Business Workspace
              </span>
              <span>Good things happen when work comes together.</span>
            </footer>
          </main>
        </div>
      </div>
      {editing && (
        <RecordEditor
          tool={editing.tool}
          item={editing.item}
          onClose={() => setEditing(null)}
          onSave={saved}
        />
      )}
      {archive && (
        <Modal
          title={archive.archived ? 'Restore record' : 'Archive record'}
          onClose={() => {
            if (!archiveBusy) setArchive(null);
          }}
        >
          <div className="modal-body">
            <p>
              {archive.archived ? 'Restore' : 'Archive'} <strong>{archive.title}</strong>?
            </p>
            <p className="muted">
              {archive.archived
                ? 'It will return to your active records.'
                : 'It will be hidden from the active list. You can restore it from the archive at any time.'}
            </p>
            <p className="error" role="alert">
              {archiveError}
            </p>
            <div className="modal-actions">
              <button autoFocus disabled={archiveBusy} onClick={() => setArchive(null)}>
                Cancel
              </button>
              <button
                className={archive.archived ? 'primary' : 'warning'}
                disabled={archiveBusy}
                onClick={() => void toggleArchive()}
              >
                {archiveBusy ? 'Saving…' : archive.archived ? 'Restore' : 'Archive'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {panel === 'notifications' && (
        <Modal title="Due reminders" onClose={() => setPanel('')}>
          <div className="modal-body">
            <p className="muted">
              Deadlines up to today in your local time zone. Reminders are shown here; no email has
              been sent.
            </p>
            {due.map((r) => (
              <button className="recent-item" key={r.id} onClick={() => navigate(r.module)}>
                <Icon name={getTool(r.module).icon} />
                <span>
                  <strong>{r.title}</strong>
                  <small>
                    {getTool(r.module).name} · {date(String(r.data.due))}
                  </small>
                </span>
                <Icons.ArrowRight size={16} />
              </button>
            ))}
            {!due.length && (
              <Empty
                title="A clear day ahead"
                detail="Due invoices, renewals, maintenance and project deadlines will appear here."
              />
            )}
          </div>
        </Modal>
      )}
      {panel === 'settings' && (
        <Modal title="Workspace settings" onClose={() => setPanel('')}>
          <div className="modal-body">
            <div className="settings-identity">
              <span className="avatar">{state.user.name.slice(0, 1)}</span>
              <div>
                <h3>{state.user.name}</h3>
                <p className="muted">{state.user.email}</p>
              </div>
            </div>
            <dl className="settings-list">
              <div>
                <dt>Workspace access</dt>
                <dd>Private · one account</dd>
              </div>
              <div>
                <dt>Storage</dt>
                <dd>Local server database</dd>
              </div>
              <div>
                <dt>Billing</dt>
                <dd>Not connected · no charges</dd>
              </div>
              <div>
                <dt>Time zone</dt>
                <dd>{Intl.DateTimeFormat().resolvedOptions().timeZone}</dd>
              </div>
              <div>
                <dt>Record capacity</dt>
                <dd>{state.records.length} / 1,000</dd>
              </div>
            </dl>
            <p className="muted">
              Back up your workspace before moving servers. A backup contains your saved records and
              check history.
            </p>
            <div className="actions">
              <button
                onClick={() =>
                  download(
                    'workspace-backup.json',
                    JSON.stringify(state, null, 2),
                    'application/json',
                  )
                }
              >
                <Icons.Download size={16} />
                Download backup
              </button>
              <button
                onClick={async () => {
                  try {
                    await api('/logout', 'POST', {});
                    setPanel('');
                    setState(null);
                  } catch (e) {
                    setNotice((e as Error).message);
                  }
                }}
              >
                <Icons.LogOut size={16} />
                Sign out
              </button>
            </div>
          </div>
        </Modal>
      )}
      {panel === 'release' && (
        <Modal title="What’s ready in this release" onClose={() => setPanel('')} wide>
          <div className="modal-body">
            <p>
              All 30 tools have saved workspaces. File utilities run in your browser; website checks
              run on your server.
            </p>
            <div className="release-grid">
              <div>
                <h3>Ready to use</h3>
                <ul>
                  <li>Private accounts and saved records</li>
                  <li>Proposals, invoices and project calculations</li>
                  <li>Appointment conflict checks</li>
                  <li>CSV cleanup, image resizing and PDF processing</li>
                  <li>SRT caption editing and quiz creation</li>
                  <li>Website checks and change fingerprints</li>
                  <li>Archive, restore, export and in-app due reminders</li>
                </ul>
              </div>
              <div>
                <h3>Still to connect</h3>
                <ul>
                  <li>Payments and subscription billing</li>
                  <li>Automatic transcription, translation and AI</li>
                  <li>Video rendering and private uploads</li>
                  <li>Public client portals, storefronts and booking pages</li>
                  <li>Email, SMS and calendar integration</li>
                  <li>Team access, account recovery and hosted storage</li>
                </ul>
              </div>
            </div>
            <p className="notice">
              This is a development release. Do not use it to collect customer payments or treat it
              as a launched production service.
            </p>
          </div>
        </Modal>
      )}
      {checkResult && (
        <Modal
          title={checkResult.title + ' — check result'}
          onClose={() => setCheckResult(null)}
          wide
        >
          <div className="modal-body">
            <p className="badge">
              {checkResult.value.error
                ? 'Check failed'
                : `HTTP ${checkResult.value.status} · ${checkResult.value.ms} ms`}
            </p>
            {checkResult.value.error && <p className="error">{checkResult.value.error}</p>}
            {checkResult.value.changed !== undefined && (
              <p>
                {checkResult.value.changed
                  ? 'This page has changed since the last check.'
                  : 'No change detected, or this is the first successful check.'}
              </p>
            )}
            {checkResult.value.certificateExpires && (
              <p>Certificate expires: {date(checkResult.value.certificateExpires)}</p>
            )}
            {checkResult.value.links && (
              <div className="table-scroll">
                <table>
                  <caption>Link results (up to 20 links)</caption>
                  <thead>
                    <tr>
                      <th>URL</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkResult.value.links.map((l, i) => (
                      <tr key={i}>
                        <td className="wrap-anywhere">{l.url}</td>
                        <td>{l.error || l.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Modal>
      )}
      {print && (
        <div className="print-preview">
          <div className="print-toolbar">
            <button onClick={() => setPrint(null)}>Close print preview</button>
            <button onClick={() => window.print()}>Print / save PDF</button>
          </div>
          <h1>{state.user.name}</h1>
          {print.map((r) => (
            <article key={r.id}>
              <p>
                {getTool(r.module).name} · {r.status}
              </p>
              <h2>{r.title}</h2>
              {getTool(r.module).fields.map((f) => (
                <div key={f.key}>
                  <strong>{f.label}</strong>
                  <p className="preserve-lines">{String(r.data[f.key] ?? '')}</p>
                </div>
              ))}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
function ToolCard({
  tool,
  starred,
  onStar,
  onOpen,
  count,
}: {
  tool: Tool;
  starred: boolean;
  onStar: () => void;
  onOpen: () => void;
  count: number;
}) {
  return (
    <article className="tool-card">
      <div className="tool-card-head">
        <span className={'tool-icon ' + tool.group.toLowerCase()}>
          <Icon name={tool.icon} size={23} />
        </span>
        <button
          className={'icon-button star ' + (starred ? 'starred' : '')}
          aria-label={(starred ? 'Unstar ' : 'Star ') + tool.name}
          aria-pressed={starred}
          onClick={onStar}
        >
          <Icons.Star size={17} fill={starred ? 'currentColor' : 'none'} />
        </button>
      </div>
      <button className="tool-open" onClick={onOpen}>
        <span className="card-category">{tool.group}</span>
        <h3>{tool.name}</h3>
        <p>{tool.description}</p>
        <span className="tool-card-footer">
          <span>
            {count ? count + ' saved' : tool.utility ? 'Open workbench' : 'Open workspace'}
          </span>
          <Icons.ArrowUpRight size={18} />
        </span>
      </button>
    </article>
  );
}
function RecordSummary({ item: r }: { item: Item }) {
  if (['projects', 'invoices', 'proposals', 'catalogues', 'store', 'licences'].includes(r.module)) {
    const n =
      r.module === 'projects'
        ? Number(r.data.amount || 0) - Number(r.data.cost || 0)
        : r.module === 'invoices'
          ? Number(r.data.amount || 0) - Number(r.data.paid || 0)
          : r.data.amount;
    return (
      <span className="numeric">
        {money(n, r.data.currency)}
        <small className="muted">
          {r.module === 'projects' ? ' profit' : r.module === 'invoices' ? ' outstanding' : ''}
        </small>
      </span>
    );
  }
  if (r.data.due) return <span className="small">Due {date(String(r.data.due))}</span>;
  if (r.data.start)
    return <span className="small">{new Date(String(r.data.start)).toLocaleString()}</span>;
  return <span className="record-excerpt">{String(r.data.notes || r.data.category || '—')}</span>;
}
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="loading-screen">
        <h1>This page could not open.</h1>
        <p>Your saved records are still on the server.</p>
        <button onClick={() => location.assign('/')}>Return to workspace</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
