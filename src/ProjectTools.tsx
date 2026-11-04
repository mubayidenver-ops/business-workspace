import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from './ui';
import { api, date, download, money, today } from './lib';
import type { Item } from './types';
import { profitReport, projectFinancials } from '../shared/projects.mjs';
import { workOrderStatuses } from '../shared/equipment.mjs';
import { writeCSV } from '../shared/csv.mjs';

type ReportRow = {
  id: string;
  title: string;
  client: string;
  status: string;
  currency: string;
  hours: number;
  revenue: number;
  expenses: number;
  labour: number;
  profit: number;
  margin: number | null;
};
type Entry = { date: string; hours: number; person: string; note: string; billable: boolean };
type Order = {
  id: string;
  title: string;
  status: string;
  assignee: string;
  due: string;
  completed: string;
  cost: string;
  notes: string;
};
const parse = <T,>(value: unknown): T[] => {
  try {
    return value ? JSON.parse(String(value)) : [];
  } catch {
    return [];
  }
};
async function saveData(item: Item, patch: Record<string, unknown>) {
  return api<Item>('/records/' + item.id, 'PATCH', {
    version: item.version,
    title: item.title,
    status: item.status,
    data: { ...item.data, ...patch },
  });
}

export function TimesheetModal({
  item,
  onClose,
  onSaved,
}: {
  item: Item;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>(() => parse<Entry>(item.data.timeEntries)),
    [draft, setDraft] = useState<Entry>({
      date: today(),
      hours: 1,
      person: '',
      note: '',
      billable: true,
    }),
    [error, setError] = useState('');
  const f = projectFinancials({ ...item.data, timeEntries: JSON.stringify(entries) });
  const currency = item.data.currency || 'USD';
  async function save() {
    setError('');
    try {
      await saveData(item, { timeEntries: JSON.stringify(entries) });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function add(e: FormEvent) {
    e.preventDefault();
    setEntries([draft, ...entries]);
    setDraft({ ...draft, note: '' });
  }
  return (
    <Modal title={'Timesheet · ' + item.title} onClose={onClose} wide>
      <div className="modal-body">
        <form className="form-grid timesheet-form" onSubmit={add}>
          <label>
            Date
            <input
              type="date"
              required
              value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })}
            />
          </label>
          <label>
            Hours
            <input
              type="number"
              min={0.25}
              max={24}
              step={0.25}
              required
              value={draft.hours}
              onChange={(e) => setDraft({ ...draft, hours: Number(e.target.value) })}
            />
          </label>
          <label>
            Person
            <input
              value={draft.person}
              onChange={(e) => setDraft({ ...draft, person: e.target.value })}
            />
          </label>
          <label>
            Note
            <input
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.billable}
              onChange={(e) => setDraft({ ...draft, billable: e.target.checked })}
            />{' '}
            Billable
          </label>
          <button type="submit">
            <Plus size={16} /> Add time
          </button>
        </form>
        <table className="mini-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Hours</th>
              <th>Person</th>
              <th>Note</th>
              <th>Billable</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i}>
                <td>{date(e.date)}</td>
                <td className="numeric">{e.hours}</td>
                <td>{e.person}</td>
                <td>{e.note}</td>
                <td>{e.billable ? 'Yes' : 'No'}</td>
                <td>
                  <button
                    className="icon-button"
                    aria-label="Remove entry"
                    onClick={() => setEntries(entries.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="settings-list">
          <div>
            <dt>Hours</dt>
            <dd>
              {f.hours} ({f.billableHours} billable)
            </dd>
          </div>
          <div>
            <dt>Revenue</dt>
            <dd>{money(f.revenue, currency)}</dd>
          </div>
          <div>
            <dt>Labour cost</dt>
            <dd>{money(f.labour, currency)}</dd>
          </div>
          <div>
            <dt>Profit</dt>
            <dd>
              {money(f.profit, currency)} {f.margin !== null && `· ${f.margin}%`}
            </dd>
          </div>
        </dl>
        <div className="actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>
            Save timesheet
          </button>
        </div>
        <p className="error" role="alert">
          {error}
        </p>
      </div>
    </Modal>
  );
}

export function ProfitReport({ records, onClose }: { records: Item[]; onClose: () => void }) {
  const [includeArchived, setIncludeArchived] = useState(false);
  const report = profitReport(records.filter((r) => includeArchived || !r.archived)) as {
    rows: ReportRow[];
    totals: (Omit<ReportRow, 'id' | 'title' | 'client' | 'status'> & { projects: number })[];
  };
  return (
    <Modal title="Profit report · all projects" onClose={onClose} wide>
      <div className="modal-body">
        <div className="report-totals">
          {report.totals.map((t) => (
            <div key={t.currency} className="stat">
              <small>
                {t.currency} · {t.projects} projects
              </small>
              <strong>{money(t.profit, t.currency)}</strong>
              <span className="muted">
                {money(t.revenue, t.currency)} revenue · {t.hours} h{' '}
                {t.margin !== null && `· ${t.margin}% margin`}
              </span>
            </div>
          ))}
          {!report.totals.length && <p className="muted">Add projects to see profit.</p>}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />{' '}
          Include archived projects
        </label>
        <table className="mini-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Client</th>
              <th>Hours</th>
              <th>Revenue</th>
              <th>Costs</th>
              <th>Profit</th>
              <th>Margin</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.title}</td>
                <td>{r.client}</td>
                <td className="numeric">{r.hours}</td>
                <td className="numeric">{money(r.revenue, r.currency)}</td>
                <td className="numeric">{money(r.expenses + r.labour, r.currency)}</td>
                <td className={'numeric ' + (r.profit < 0 ? 'negative' : '')}>
                  {money(r.profit, r.currency)}
                </td>
                <td className="numeric">{r.margin === null ? '—' : r.margin + '%'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="actions">
          <button
            onClick={() =>
              download(
                'profit-report.csv',
                writeCSV([
                  [
                    'Project',
                    'Client',
                    'Status',
                    'Currency',
                    'Hours',
                    'Revenue',
                    'Expenses',
                    'Labour',
                    'Profit',
                    'Margin %',
                  ],
                  ...report.rows.map((r) => [
                    r.title,
                    r.client,
                    r.status,
                    r.currency,
                    r.hours,
                    r.revenue,
                    r.expenses,
                    r.labour,
                    r.profit,
                    r.margin ?? '',
                  ]),
                ]),
                'text/csv',
              )
            }
          >
            Export CSV
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function WorkOrdersModal({
  item,
  onClose,
  onSaved,
}: {
  item: Item;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [orders, setOrders] = useState<Order[]>(() => parse<Order>(item.data.workOrders)),
    [service, setService] = useState({ date: today(), notes: '', cost: '', workOrderId: '' }),
    [title, setTitle] = useState(''),
    [error, setError] = useState('');
  const log = parse<{ date: string; notes: string; cost: string; workOrder?: string }>(
    item.data.serviceLog,
  );
  const interval = Number(item.data.serviceIntervalDays || 0);
  async function run(work: () => Promise<unknown>) {
    setError('');
    try {
      await work();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const update = (id: string, patch: Partial<Order>) =>
    setOrders(orders.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  return (
    <Modal title={'Service & work orders · ' + item.title} onClose={onClose} wide>
      <div className="modal-body">
        <p className="muted">
          {interval > 0 ? `Serviced every ${interval} days.` : 'One-off service.'} Next service:{' '}
          {item.data.due ? date(String(item.data.due)) : 'not set'}
          {item.data.lastService ? ` · last serviced ${date(String(item.data.lastService))}` : ''}
        </p>
        <h3>Work orders</h3>
        <table className="mini-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Status</th>
              <th>Assignee</th>
              <th>Due</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>{o.title}</td>
                <td>
                  <select
                    aria-label={'Status of ' + o.title}
                    value={o.status}
                    onChange={(e) =>
                      update(o.id, {
                        status: e.target.value,
                        completed: e.target.value === 'Done' ? today() : '',
                      })
                    }
                  >
                    {workOrderStatuses.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    aria-label={'Assignee of ' + o.title}
                    value={o.assignee}
                    onChange={(e) => update(o.id, { assignee: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={'Due date of ' + o.title}
                    type="date"
                    value={o.due}
                    onChange={(e) => update(o.id, { due: e.target.value })}
                  />
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={'Remove ' + o.title}
                    onClick={() => setOrders(orders.filter((x) => x.id !== o.id))}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form
          className="window-row"
          onSubmit={(e) => {
            e.preventDefault();
            setOrders([
              ...orders,
              {
                id: 'wo-' + crypto.randomUUID().slice(0, 8),
                title,
                status: 'Open',
                assignee: '',
                due: String(item.data.due || ''),
                completed: '',
                cost: '',
                notes: '',
              },
            ]);
            setTitle('');
          }}
        >
          <input
            aria-label="New work order"
            placeholder="New work order"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button type="submit">
            <Plus size={16} /> Add
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => run(() => saveData(item, { workOrders: JSON.stringify(orders) }))}
          >
            Save work orders
          </button>
        </form>
        <h3>Log a completed service</h3>
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            run(() =>
              api('/records/' + item.id + '/service', 'POST', {
                version: item.version,
                ...service,
              }),
            );
          }}
        >
          <label>
            Date
            <input
              type="date"
              required
              value={service.date}
              onChange={(e) => setService({ ...service, date: e.target.value })}
            />
          </label>
          <label>
            Cost
            <input
              type="number"
              min={0}
              value={service.cost}
              onChange={(e) => setService({ ...service, cost: e.target.value })}
            />
          </label>
          <label>
            Closes work order
            <select
              value={service.workOrderId}
              onChange={(e) => setService({ ...service, workOrderId: e.target.value })}
            >
              <option value="">None</option>
              {parse<Order>(item.data.workOrders)
                .filter((o) => o.status !== 'Done')
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
            </select>
          </label>
          <label className="span-2">
            Notes
            <textarea
              rows={2}
              value={service.notes}
              onChange={(e) => setService({ ...service, notes: e.target.value })}
            />
          </label>
          <button className="primary" type="submit">
            Log service{interval > 0 ? ' and schedule next' : ''}
          </button>
        </form>
        {log.length > 0 && (
          <>
            <h3>Service history</h3>
            <ul className="team-list">
              {log.map((l, i) => (
                <li key={i}>
                  <span>
                    <strong>{date(l.date)}</strong>
                    <small className="muted">{l.notes || 'Service completed'}</small>
                  </span>
                  {l.cost && <span className="numeric">{l.cost}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="error" role="alert">
          {error}
        </p>
      </div>
    </Modal>
  );
}
