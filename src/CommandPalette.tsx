import { useState } from 'react';
import { Search, ArrowRight } from 'lucide-react';
import { Modal } from './ui';
import type { Tool } from './types';

export function CommandPalette({
  tools,
  open,
  close,
}: {
  tools: Tool[];
  open: (view: string) => void;
  close: () => void;
}) {
  const [query, setQuery] = useState('');
  const entries = [{ id: 'overview', name: 'Overview', group: 'Workspace' }, ...tools]
    .filter((entry) =>
      (entry.name + ' ' + entry.group).toLowerCase().includes(query.trim().toLowerCase()),
    )
    .slice(0, 12);
  return (
    <Modal title="Go to a tool" onClose={close}>
      <div className="modal-body">
        <label>
          <Search size={16} /> Search workspace tools
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && entries.length) {
                event.preventDefault();
                open(entries[0].id);
              }
            }}
            placeholder="Search by name or category"
          />
        </label>
        {entries.map((entry) => (
          <button key={entry.id} className="recent-item" onClick={() => open(entry.id)}>
            <span>
              <strong>{entry.name}</strong>
              <small>{entry.group}</small>
            </span>
            <ArrowRight size={16} />
          </button>
        ))}
        {!entries.length && <p className="muted">No matching tools.</p>}
      </div>
    </Modal>
  );
}
