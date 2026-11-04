import { useState } from 'react';
import { Search, ArrowRight } from 'lucide-react';
import { Modal } from './ui';
import type { Item, Tool } from './types';

export function CommandPalette({
  tools,
  records,
  open,
  openRecord,
  close,
}: {
  tools: Tool[];
  records: Item[];
  open: (view: string) => void;
  openRecord: (tool: Tool, record: Item) => void;
  close: () => void;
}) {
  const [query, setQuery] = useState('');
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (text: string) => terms.every((term) => text.toLowerCase().includes(term));
  const byId = new Map(tools.map((tool) => [tool.id, tool]));
  const matchingRecords = terms.length
    ? records
        .flatMap((record) => {
          const tool = byId.get(record.module);
          if (!tool || record.archived) return [];
          const fields = tool.fields.map(({ key }) => record.data[key] || '');
          return matches([record.title, tool.name, ...fields].join(' ')) ? [{ record, tool }] : [];
        })
        .slice(0, 8)
    : [];
  const entries = [{ id: 'overview', name: 'Overview', group: 'Workspace' }, ...tools]
    .filter((entry) => matches(entry.name + ' ' + entry.group))
    .slice(0, matchingRecords.length ? 4 : 12);
  return (
    <Modal title="Search workspace" onClose={close}>
      <div className="modal-body">
        <label>
          <Search size={16} /> Search tools and records
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (matchingRecords.length || entries.length)) {
                event.preventDefault();
                const first = matchingRecords[0];
                if (first) openRecord(first.tool, first.record);
                else open(entries[0].id);
              }
            }}
            placeholder="Search by tool, record title or details"
          />
        </label>
        {!!matchingRecords.length && <h3>Records</h3>}
        {matchingRecords.map(({ record, tool }) => (
          <button key={record.id} className="recent-item" onClick={() => openRecord(tool, record)}>
            <span>
              <strong>{record.title}</strong>
              <small>
                {tool.name} · {record.status}
              </small>
            </span>
            <ArrowRight size={16} />
          </button>
        ))}
        {!!entries.length && <h3>Tools</h3>}
        {entries.map((entry) => (
          <button key={entry.id} className="recent-item" onClick={() => open(entry.id)}>
            <span>
              <strong>{entry.name}</strong>
              <small>{entry.group}</small>
            </span>
            <ArrowRight size={16} />
          </button>
        ))}
        {!entries.length && !matchingRecords.length && (
          <p className="muted">No matching tools or active records.</p>
        )}
      </div>
    </Modal>
  );
}
