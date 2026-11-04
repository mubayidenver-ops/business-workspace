import { randomUUID } from 'node:crypto';
export const storageError = (status, message) => Object.assign(new Error(message), { status });
export function assertBooking(records, candidate) {
  if (
    candidate.module !== 'booking' ||
    candidate.archived ||
    ['Cancelled', 'Completed'].includes(candidate.status)
  )
    return;
  const data = JSON.parse(candidate.data);
  if (
    records.some((r) => {
      if (
        r.id === candidate.id ||
        r.module !== 'booking' ||
        r.archived ||
        ['Cancelled', 'Completed'].includes(r.status)
      )
        return false;
      const existing = JSON.parse(r.data);
      const endsWithBuffer = (booking) =>
        Date.parse(booking.end) + (Number(booking.bufferMinutes) || 0) * 60000;
      return (
        Date.parse(data.start) < endsWithBuffer(existing) &&
        endsWithBuffer(data) > Date.parse(existing.start)
      );
    })
  ) {
    throw storageError(409, 'That time overlaps another appointment. Choose another time.');
  }
}
export function makeRecord(userId, module, record, records) {
  if (records.length >= 1000)
    throw storageError(400, 'This development release supports 1,000 records per workspace.');
  const now = new Date().toISOString();
  const result = {
    id: randomUUID(),
    user_id: userId,
    module,
    title: record.title,
    status: record.status,
    data: JSON.stringify(record.data),
    archived: false,
    version: 1,
    votes: 0,
    created: now,
    updated: now,
  };
  assertBooking(records, result);
  return result;
}
export function changeRecord(records, id, version, patch) {
  const current = records.find((r) => r.id === id);
  if (!current) throw storageError(404, 'This record is not available.');
  if (current.version !== version)
    throw storageError(
      409,
      'This record changed in another window. Close and reopen it before saving.',
    );
  const next = {
    ...current,
    ...patch,
    version: current.version + 1,
    updated: new Date().toISOString(),
  };
  assertBooking(records, next);
  return next;
}
export function replayRequest(previous, hash, records) {
  if (!previous) return null;
  if (previous.hash !== hash)
    throw storageError(
      409,
      'This request was already saved with different details. Close this editor and reopen the saved record.',
    );
  const record = records.find((r) => r.id === previous.record_id);
  if (!record) throw storageError(409, 'The original saved record is unavailable.');
  return record;
}
export function isMonitor(record) {
  return (
    !record.archived && record.status === 'Active' && ['uptime', 'changes'].includes(record.module)
  );
}
