import { useRef, useState, type FormEvent } from 'react';
import { api } from './lib';
import { Modal } from './ui';

function localSlot(value: string, days: number) {
  const [date, time] = value.split('T');
  if (!date || !time) throw new Error('Enter a start and end date and time.');
  const nextDate = new Date(date + 'T00:00:00Z');
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  const local = nextDate.toISOString().slice(0, 10) + 'T' + time;
  const point = new Date(local);
  const check = new Date(point.getTime() - point.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  if (check !== local)
    throw new Error('One slot falls in a daylight saving time gap. Change the time.');
  return point.toISOString();
}

export function BookingSeries({ close, saved }: { close: () => void; saved: () => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [count, setCount] = useState(4);
  const [step, setStep] = useState(7);
  const [buffer, setBuffer] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<{ content: string; key: string }>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const slots = Array.from({ length: count }, (_, index) => ({
        start: localSlot(start, index * step),
        end: localSlot(end, index * step),
      }));
      const payload = { title, bufferMinutes: buffer, slots };
      const content = JSON.stringify(payload);
      if (request.current?.content !== content)
        request.current = { content, key: crypto.randomUUID() };
      await api('/booking-series', 'POST', { ...payload, requestKey: request.current.key });
      await saved();
      close();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Reserve a recurring series"
      onClose={() => {
        if (!busy) close();
      }}
    >
      <form className="modal-body" onSubmit={submit}>
        <p className="muted">
          Reserve 2 to 13 offered slots at the same local time. If any slot overlaps an existing
          appointment, the entire series is rejected.
        </p>
        <label>
          Appointment title
          <input
            required
            maxLength={180}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          First slot starts
          <input
            required
            type="datetime-local"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
        <label>
          First slot ends
          <input
            required
            type="datetime-local"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </label>
        <label>
          Repeat every
          <select value={step} onChange={(event) => setStep(Number(event.target.value))}>
            <option value={1}>Day</option>
            <option value={7}>Week</option>
            <option value={14}>Two weeks</option>
          </select>
        </label>
        <label>
          Number of slots
          <input
            required
            type="number"
            min={2}
            max={13}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          />
        </label>
        <label>
          Buffer in minutes
          <input
            required
            type="number"
            min={0}
            max={120}
            value={buffer}
            onChange={(event) => setBuffer(Number(event.target.value))}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? 'Reserving…' : 'Reserve series'}
        </button>
      </form>
    </Modal>
  );
}
