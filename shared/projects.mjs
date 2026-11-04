const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round = (v) => Math.round(v * 100) / 100;
export function parseTimeEntries(value) {
  if (value === undefined || value === null || value === '') return [];
  let entries;
  try {
    entries = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    throw new Error('Time entries must be valid JSON.');
  }
  if (!Array.isArray(entries) || entries.length > 500)
    throw new Error('Record up to 500 time entries per project.');
  return entries.map((entry, index) => {
    const label = `Time entry ${index + 1}`;
    if (!entry || typeof entry !== 'object') throw new Error(`${label} is invalid.`);
    const date = String(entry.date || '');
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date
    )
      throw new Error(`${label} needs a valid date.`);
    const hours = Number(entry.hours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24)
      throw new Error(`${label} needs between 0 and 24 hours.`);
    const person = String(entry.person || '').trim();
    const note = String(entry.note || '').trim();
    if (person.length > 80 || note.length > 500)
      throw new Error(`${label}: keep the person under 80 and the note under 500 characters.`);
    return { date, hours: round(hours), person, note, billable: entry.billable !== false };
  });
}
export function projectFinancials(data) {
  let entries = [];
  try {
    entries = parseTimeEntries(data.timeEntries);
  } catch {
    entries = [];
  }
  const tracked = entries.length > 0;
  const hours = tracked ? entries.reduce((s, e) => s + e.hours, 0) : num(data.billableHours);
  const billableHours = tracked
    ? entries.filter((e) => e.billable).reduce((s, e) => s + e.hours, 0)
    : num(data.billableHours);
  const timeRevenue = billableHours * num(data.hourlyRate);
  const revenue = num(data.amount) + timeRevenue;
  const expenses = num(data.cost);
  const labour = hours * num(data.hourlyCost);
  const profit = revenue - expenses - labour;
  return {
    tracked,
    hours: round(hours),
    billableHours: round(billableHours),
    timeRevenue: round(timeRevenue),
    revenue: round(revenue),
    expenses: round(expenses),
    labour: round(labour),
    profit: round(profit),
    margin: revenue > 0 ? round((profit / revenue) * 100) : null,
  };
}
export function profitReport(records) {
  const rows = records
    .filter((r) => r.module === 'projects')
    .map((r) => ({
      id: r.id,
      title: r.title,
      client: String(r.data.client || ''),
      status: r.status,
      currency: String(r.data.currency || 'USD').toUpperCase(),
      ...projectFinancials(r.data),
    }));
  const totals = {};
  for (const row of rows) {
    const t = (totals[row.currency] ||= {
      currency: row.currency,
      projects: 0,
      hours: 0,
      revenue: 0,
      expenses: 0,
      labour: 0,
      profit: 0,
    });
    t.projects++;
    for (const key of ['hours', 'revenue', 'expenses', 'labour', 'profit'])
      t[key] = round(t[key] + row[key]);
  }
  for (const t of Object.values(totals))
    t.margin = t.revenue > 0 ? round((t.profit / t.revenue) * 100) : null;
  return {
    rows: rows.sort((a, b) => b.profit - a.profit),
    totals: Object.values(totals).sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}
