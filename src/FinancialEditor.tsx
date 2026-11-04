import { Plus, Trash2 } from 'lucide-react';
import { calculateDocument, documentFromData } from '../shared/pricing.mjs';
import { money } from './lib';
import type { Item } from './types';
type Data = Record<string, string | boolean>;
type Line = { description: string; quantity: string | number; rate: string | number };
export function FinancialEditor({
  data,
  onChange,
}: {
  data: Data;
  onChange: (data: Data) => void;
}) {
  let lines: Line[];
  try {
    lines = JSON.parse(String(data.lineItems || '[]'));
  } catch {
    lines = [];
  }
  const currency = String(data.currency || 'USD').toUpperCase();
  let total;
  let error = '';
  try {
    total = calculateDocument(
      lines,
      currency,
      Number(data.discountPercent || 0),
      Number(data.taxPercent || 0),
    );
  } catch (e) {
    error = (e as Error).message;
  }
  function setLines(next: Line[]) {
    onChange({ ...data, lineItems: JSON.stringify(next) });
  }
  return (
    <section className="document-editor">
      <div className="section-heading">
        <div>
          <span className="eyebrow">THE DETAILS THAT ADD UP</span>
          <h3>Services & line items</h3>
        </div>
        <span className="badge">{currency}</span>
      </div>
      {lines.map((line, i) => (
        <div className="line-editor" key={i}>
          <label className="line-description">
            Description
            <input
              required
              maxLength={300}
              value={line.description}
              placeholder="e.g. Brand identity design"
              onChange={(e) =>
                setLines(lines.map((l, n) => (n === i ? { ...l, description: e.target.value } : l)))
              }
            />
          </label>
          <label>
            Quantity
            <input
              type="number"
              min="0.0001"
              step="any"
              required
              value={line.quantity}
              onChange={(e) =>
                setLines(lines.map((l, n) => (n === i ? { ...l, quantity: e.target.value } : l)))
              }
            />
          </label>
          <label>
            Rate
            <input
              type="number"
              min="0"
              step="any"
              required
              value={line.rate}
              onChange={(e) =>
                setLines(lines.map((l, n) => (n === i ? { ...l, rate: e.target.value } : l)))
              }
            />
          </label>
          <button
            type="button"
            className="icon-button"
            aria-label={'Remove line ' + (i + 1)}
            disabled={lines.length <= 1}
            onClick={() => setLines(lines.filter((_, n) => n !== i))}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={lines.length >= 40}
        onClick={() => setLines([...lines, { description: '', quantity: 1, rate: 0 }])}
      >
        <Plus size={16} />
        Add line item
      </button>
      <div className="financial-bottom">
        <div className="form-grid">
          <label>
            Discount (%)
            <input
              type="number"
              min="0"
              max="100"
              step="any"
              value={String(data.discountPercent || '0')}
              onChange={(e) => onChange({ ...data, discountPercent: e.target.value })}
            />
          </label>
          <label>
            Tax (%)
            <input
              type="number"
              min="0"
              max="100"
              step="any"
              value={String(data.taxPercent || '0')}
              onChange={(e) => onChange({ ...data, taxPercent: e.target.value })}
            />
          </label>
        </div>
        <dl className="document-totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{total ? money(total.subtotal, currency) : '—'}</dd>
          </div>
          <div>
            <dt>Discount</dt>
            <dd>{total ? money(total.discount, currency) : '—'}</dd>
          </div>
          <div>
            <dt>Tax</dt>
            <dd>{total ? money(total.tax, currency) : '—'}</dd>
          </div>
          <div className="grand-total">
            <dt>Total</dt>
            <dd>{total ? money(total.total, currency) : '—'}</dd>
          </div>
        </dl>
      </div>
      {error && <p className="muted small">{error}</p>}
      <p className="muted small">
        Tax is applied after the discount. Amounts round to the currency’s minor unit. You choose
        the tax percentage.
      </p>
    </section>
  );
}
export function DocumentView({
  title,
  brand,
  data,
  module,
  document,
}: {
  title: string;
  brand: string;
  data: Data;
  module: string;
  document?: ReturnType<typeof documentFromData>;
}) {
  let calculated = document;
  try {
    if (calculated === undefined) calculated = documentFromData(data);
  } catch {
    calculated = null;
  }
  const currency = String(data.currency || 'USD');
  return (
    <article className="business-document">
      <header>
        <div>
          <span className="eyebrow">{module === 'invoices' ? 'INVOICE' : 'PROPOSAL'}</span>
          <h2>{brand}</h2>
        </div>
        <span className="document-seal">BW</span>
      </header>
      <h1>{title}</h1>
      <div className="document-meta">
        <div>
          <span>Prepared for</span>
          <strong>{String(data.client || 'Client')}</strong>
        </div>
        {data.due && (
          <div>
            <span>{module === 'proposals' ? 'Quote expiry date' : 'Due date'}</span>
            <strong>{String(data.due)}</strong>
          </div>
        )}
        <div>
          <span>Currency</span>
          <strong>{currency}</strong>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">Document line items</caption>
          <thead>
            <tr>
              <th>Description</th>
              <th>Quantity</th>
              <th>Rate</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {calculated ? (
              calculated.lines.map((line, i) => (
                <tr key={i}>
                  <td>{line.description}</td>
                  <td>{line.quantity}</td>
                  <td>{money(line.rate, currency)}</td>
                  <td>{money(line.total, currency)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td>Services</td>
                <td>1</td>
                <td>{money(data.amount, currency)}</td>
                <td>{money(data.amount, currency)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <dl className="document-totals">
        {calculated && (
          <>
            <div>
              <dt>Subtotal</dt>
              <dd>{money(calculated.subtotal, currency)}</dd>
            </div>
            <div>
              <dt>Discount</dt>
              <dd>−{money(calculated.discount, currency)}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>{money(calculated.tax, currency)}</dd>
            </div>
          </>
        )}
        <div className="grand-total">
          <dt>Total</dt>
          <dd>{money(calculated?.total ?? data.amount, currency)}</dd>
        </div>
        {module === 'invoices' && (
          <>
            <div>
              <dt>Recorded as received</dt>
              <dd>{money(data.paid, currency)}</dd>
            </div>
            <div>
              <dt>Outstanding balance</dt>
              <dd>
                {money(Number(calculated?.total ?? data.amount) - Number(data.paid || 0), currency)}
              </dd>
            </div>
          </>
        )}
      </dl>
      {data.notes && (
        <section className="document-notes">
          <h3>Scope & notes</h3>
          <p className="preserve-lines">{String(data.notes)}</p>
        </section>
      )}
    </article>
  );
}
