import { ArrowUpRight, MessageCircle, Wallet, CheckCircle2, ArrowRight } from 'lucide-react';
import type { Item } from './types';
import { money } from './lib';
export function BusinessInsights({
  records,
  onOpen,
  onNavigate,
}: {
  records: Item[];
  onOpen: (record: Item) => void;
  onNavigate: (view: string) => void;
}) {
  const active = records.filter((r) => !r.archived),
    balances = new Map<string, number>();
  for (const r of active.filter((r) => r.module === 'invoices' && r.status !== 'Cancelled')) {
    const currency = String(r.data.currency || 'USD');
    balances.set(
      currency,
      (balances.get(currency) || 0) +
        Math.max(0, Number(r.data.amount || 0) - Number(r.data.paid || 0)),
    );
  }
  const responses = active.filter((r) => r.data.clientResponse).slice(0, 3);
  const steps = [
    { id: 'onboarding', label: 'Create a client brief' },
    { id: 'proposals', label: 'Prepare your first proposal' },
    { id: 'projects', label: 'Organise a project' },
  ];
  const complete = steps.filter((s) => active.some((r) => r.module === s.id)).length;
  return (
    <section className="business-insights">
      <div className="insight-card">
        <div className="insight-heading">
          <Wallet size={20} />
          <span>Outstanding balances</span>
          <button
            className="icon-button"
            aria-label="Open invoices"
            onClick={() => onNavigate('invoices')}
          >
            <ArrowUpRight size={17} />
          </button>
        </div>
        {balances.size ? (
          <div className="balance-list">
            {[...balances].map(([currency, total]) => (
              <strong key={currency}>
                {money(total, currency)}
                <span>{currency}</span>
              </strong>
            ))}
          </div>
        ) : (
          <>
            <h3>A clearer picture of your money.</h3>
            <p className="muted small">
              Add invoices and record payments to track balances. Currencies are kept separate.
            </p>
          </>
        )}
        <button className="text-button" onClick={() => onNavigate('invoices')}>
          Manage invoices
          <ArrowRight size={14} />
        </button>
      </div>
      <div className="insight-card">
        <div className="insight-heading">
          <MessageCircle size={20} />
          <span>Client responses</span>
          <span className="badge">{active.filter((r) => r.data.clientResponse).length}</span>
        </div>
        {responses.length ? (
          responses.map((r) => (
            <button className="response-preview" key={r.id} onClick={() => onOpen(r)}>
              <span>
                <strong>{r.title}</strong>
                <small>
                  {r.status === 'Completed' ? 'Approval recorded' : 'Ready for your review'}
                </small>
              </span>
              <ArrowUpRight size={15} />
            </button>
          ))
        ) : (
          <>
            <h3>Keep the conversation moving.</h3>
            <p className="muted small">
              Share a brief, proposal or approval. Responses arrive here when clients reply.
            </p>
          </>
        )}
      </div>
      <div className="insight-card setup-card">
        <div className="insight-heading">
          <CheckCircle2 size={20} />
          <span>Your first good steps</span>
          <span className="badge">{complete}/3</span>
        </div>
        <div
          className="setup-progress"
          role="progressbar"
          aria-label="Workspace setup"
          aria-valuemin={0}
          aria-valuemax={3}
          aria-valuenow={complete}
        >
          <span style={{ width: (complete / 3) * 100 + '%' }} />
        </div>
        {steps.map((s) => (
          <button key={s.id} onClick={() => onNavigate(s.id)}>
            <CheckCircle2
              size={15}
              className={active.some((r) => r.module === s.id) ? 'step-complete' : ''}
            />
            {s.label}
            <ArrowUpRight size={13} />
          </button>
        ))}
      </div>
    </section>
  );
}
