const time = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
export function validTimeZone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return typeof zone === 'string' && zone.length <= 64;
  } catch {
    return false;
  }
}
function wholeNumber(value, min, max, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
}
export function validateAvailability(input) {
  if (!input || typeof input !== 'object') throw new Error('Availability is invalid.');
  const title = String(input.title || '').trim();
  const description = String(input.description || '').trim();
  if (!title || title.length > 120)
    throw new Error('Enter a booking page title of 1–120 characters.');
  if (description.length > 1000) throw new Error('Keep the description under 1,000 characters.');
  if (!validTimeZone(input.timezone)) throw new Error('Choose a valid time zone.');
  if (!Array.isArray(input.windows) || !input.windows.length || input.windows.length > 28)
    throw new Error('Add between 1 and 28 weekly availability windows.');
  const windows = input.windows.map((w, i) => {
    const day = Number(w?.day);
    if (!Number.isInteger(day) || day < 0 || day > 6)
      throw new Error(`Window ${i + 1} needs a weekday.`);
    if (!time.test(w.start) || !time.test(w.end) || minutes(w.end) <= minutes(w.start))
      throw new Error(`Window ${i + 1} needs a start time before its end time.`);
    return { day, start: w.start, end: w.end };
  });
  return {
    title,
    description,
    timezone: input.timezone,
    windows: windows.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start)),
    slotMinutes: wholeNumber(input.slotMinutes ?? 30, 10, 240, 'Slot length'),
    bufferMinutes: wholeNumber(input.bufferMinutes ?? 0, 0, 120, 'Buffer'),
    noticeHours: wholeNumber(input.noticeHours ?? 12, 0, 336, 'Minimum notice'),
    horizonDays: wholeNumber(input.horizonDays ?? 21, 1, 90, 'Booking horizon'),
  };
}
function zoneParts(ms, zone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  return parts;
}
/** Converts a wall-clock time in `zone` to UTC milliseconds. Returns null for times skipped by a DST change. */
export function zonedToUtc(y, m, d, minuteOfDay, zone) {
  const target = Date.UTC(y, m - 1, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = zoneParts(guess, zone);
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    guess += target - asUtc;
  }
  const p = zoneParts(guess, zone);
  const check = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return check === target ? guess : null;
}
const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export function bookingBusy(records, excludeId) {
  return records
    .filter(
      (r) =>
        r.module === 'booking' &&
        (!excludeId || r.id !== excludeId) &&
        !r.archived &&
        !['Cancelled', 'Completed'].includes(r.status),
    )
    .map((r) => {
      const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      return {
        start: Date.parse(d.start),
        end: Date.parse(d.end) + (Number(d.bufferMinutes) || 0) * 60000,
      };
    })
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end));
}
/** Open slot start times (ISO strings) generated from weekly windows, excluding busy times and the notice period. */
export function availableSlots(
  availability,
  records,
  now = Date.now(),
  { excludeId, limit = 400 } = {},
) {
  const a = availability;
  const busy = bookingBusy(records, excludeId);
  const earliest = now + a.noticeHours * 3600000;
  const latest = now + a.horizonDays * 86400000;
  const slot = a.slotMinutes * 60000;
  const out = [];
  const seen = new Set();
  for (let dayOffset = 0; dayOffset <= a.horizonDays + 1 && out.length < limit; dayOffset++) {
    const p = zoneParts(now + dayOffset * 86400000, a.timezone);
    const day = weekdays[p.weekday];
    for (const w of a.windows.filter((w) => w.day === day)) {
      for (
        let m = minutes(w.start);
        m + a.slotMinutes <= minutes(w.end);
        m += a.slotMinutes + a.bufferMinutes
      ) {
        const start = zonedToUtc(+p.year, +p.month, +p.day, m, a.timezone);
        if (start === null || seen.has(start)) continue;
        seen.add(start);
        const end = start + slot;
        if (start < earliest || start > latest) continue;
        const endWithBuffer = end + a.bufferMinutes * 60000;
        if (busy.some((b) => start < b.end && endWithBuffer > b.start)) continue;
        out.push(new Date(start).toISOString());
        if (out.length >= limit) break;
      }
    }
  }
  return out.sort();
}
