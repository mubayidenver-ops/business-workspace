export const workOrderStatuses = ['Open', 'In progress', 'Done'];
const validDate = (d) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
function parseList(value, max, label) {
  if (value === undefined || value === null || value === '') return [];
  let list;
  try {
    list = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
  if (!Array.isArray(list) || list.length > max)
    throw new Error(`Keep up to ${max} ${label.toLowerCase()}.`);
  return list;
}
function cost(value, label) {
  if (value === undefined || value === null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) throw new Error(`${label} needs a valid cost.`);
  return String(n);
}
export function parseWorkOrders(value) {
  return parseList(value, 100, 'Work orders').map((o, index) => {
    const label = `Work order ${index + 1}`;
    if (!o || typeof o !== 'object') throw new Error(`${label} is invalid.`);
    const id = String(o.id || '');
    const title = String(o.title || '').trim();
    if (!/^[a-zA-Z0-9-]{8,40}$/.test(id)) throw new Error(`${label} has an invalid id.`);
    if (!title || title.length > 180)
      throw new Error(`${label} needs a title of 1–180 characters.`);
    if (!workOrderStatuses.includes(o.status)) throw new Error(`${label} needs a valid status.`);
    const due = String(o.due || ''),
      completed = String(o.completed || '');
    if ((due && !validDate(due)) || (completed && !validDate(completed)))
      throw new Error(`${label} has an invalid date.`);
    const assignee = String(o.assignee || '').trim(),
      notes = String(o.notes || '').trim();
    if (assignee.length > 80 || notes.length > 1000)
      throw new Error(`${label}: keep the assignee under 80 and notes under 1,000 characters.`);
    return {
      id,
      title,
      status: o.status,
      assignee,
      due,
      completed: o.status === 'Done' ? completed : '',
      cost: cost(o.cost, label),
      notes,
    };
  });
}
export function parseServiceLog(value) {
  return parseList(value, 200, 'Service log entries').map((e, index) => {
    const label = `Service entry ${index + 1}`;
    if (!e || typeof e !== 'object' || !validDate(String(e.date || '')))
      throw new Error(`${label} needs a valid date.`);
    const notes = String(e.notes || '').trim();
    if (notes.length > 1000) throw new Error(`${label} notes are too long.`);
    return {
      date: e.date,
      notes,
      cost: cost(e.cost, label),
      ...(e.workOrder ? { workOrder: String(e.workOrder).slice(0, 40) } : {}),
    };
  });
}
export function addDays(date, days) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** Records a completed service: appends to the log, advances the next due date on recurring schedules, and closes the linked work order. */
export function completeService(data, input) {
  const date = String(input.date || '');
  if (!validDate(date)) throw new Error('Enter the service date.');
  const notes = String(input.notes || '').trim();
  if (notes.length > 1000) throw new Error('Keep service notes under 1,000 characters.');
  const log = parseServiceLog(data.serviceLog);
  const orders = parseWorkOrders(data.workOrders);
  const workOrder = input.workOrderId ? String(input.workOrderId) : '';
  if (workOrder && !orders.some((o) => o.id === workOrder))
    throw new Error('That work order is no longer on this asset.');
  const entry = {
    date,
    notes,
    cost: cost(input.cost, 'Service'),
    ...(workOrder ? { workOrder } : {}),
  };
  const next = [entry, ...log].slice(0, 200);
  const interval = Number(data.serviceIntervalDays || 0);
  return {
    ...data,
    lastService: date,
    due: interval > 0 ? addDays(date, interval) : data.due,
    serviceLog: JSON.stringify(next),
    workOrders: JSON.stringify(
      orders.map((o) => (o.id === workOrder ? { ...o, status: 'Done', completed: date } : o)),
    ),
  };
}
export function openWorkOrdersDue(data, today) {
  try {
    return parseWorkOrders(data.workOrders).filter(
      (o) => o.status !== 'Done' && o.due && o.due <= today,
    );
  } catch {
    return [];
  }
}
