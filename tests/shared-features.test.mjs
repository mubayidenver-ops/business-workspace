import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, crc32 } from 'node:zlib';
import { readXlsx } from '../shared/xlsx.mjs';
import { cleanRows } from '../shared/csv.mjs';
import { availableSlots, validateAvailability, zonedToUtc } from '../shared/availability.mjs';
import { profitReport, projectFinancials } from '../shared/projects.mjs';
import { completeService, openWorkOrdersDue } from '../shared/equipment.mjs';
import { totpCode, verifyTotp, base32Decode, base32Encode } from '../server/totp.mjs';

function zip(files) {
  const locals = [],
    centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text);
    const data = deflateRawSync(raw);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, dir, end]));
}

test('xlsx import reads shared strings, inline strings, dates, gaps and multiple sheets', async () => {
  const book = zip({
    'xl/workbook.xml':
      '<workbook xmlns:r="r"><sheets><sheet name="Clients" sheetId="1" r:id="rId1"/><sheet name="Two &amp; more" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml':
      '<sst><si><t>Name</t></si><si><t>Joined</t></si><si><r><t>Ana </t></r><r><t>Lopez</t></r></si><si><t>=cmd</t></si></sst>',
    'xl/styles.xml':
      '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml':
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>45658</v></c><c r="D2"><v>3.5</v></c></row>' +
      '<row r="4"><c r="A4" t="inlineStr"><is><t>Bo &lt;3</t></is></c><c r="B4" t="b"><v>1</v></c></row>' +
      '<row r="5"><c r="A5" t="s"><v>3</v></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>',
  });
  const sheets = await readXlsx(book);
  assert.deepEqual(sheets.map((s) => s.name), ['Clients', 'Two & more']);
  assert.deepEqual(sheets[0].rows, [
    ['Name', 'Joined', '', ''],
    ['Ana Lopez', '2025-01-01', '', '3.5'],
    ['', '', '', ''],
    ['Bo <3', 'TRUE', '', ''],
    ['=cmd', '', '', ''],
  ]);
  assert.throws(() => cleanRows(sheets[0].rows), /header/);
  assert.ok(cleanRows([['Name'], ['Ana Lopez'], ['Ana Lopez']]));
  await assert.rejects(readXlsx(new Uint8Array([1, 2, 3])), /not a valid \.xlsx/);
});

test('weekly availability honours time zones, DST gaps, notice and existing bookings', () => {
  const a = validateAvailability({
    title: 'Call',
    timezone: 'America/New_York',
    windows: [{ day: 1, start: '09:00', end: '11:00' }],
    slotMinutes: 60,
    noticeHours: 0,
    horizonDays: 7,
  });
  const now = Date.parse('2026-03-06T12:00:00Z');
  const slots = availableSlots(a, [], now);
  assert.deepEqual(slots, ['2026-03-09T13:00:00.000Z', '2026-03-09T14:00:00.000Z'], 'EDT after DST');
  const busy = [{ module: 'booking', status: 'Active', data: JSON.stringify({ start: slots[0], end: slots[1] }) }];
  assert.deepEqual(availableSlots(a, busy, now), [slots[1]]);
  assert.equal(zonedToUtc(2026, 3, 8, 150, 'America/New_York'), null, '02:30 does not exist');
  assert.throws(() => validateAvailability({ ...a, timezone: 'Mars/Base' }), /time zone/);
  assert.throws(() => validateAvailability({ ...a, windows: [{ day: 1, start: '10:00', end: '09:00' }] }), /before its end/);
});

test('project profit uses timesheets and totals per currency', () => {
  const data = {
    amount: '500',
    hourlyRate: '100',
    hourlyCost: '40',
    cost: '50',
    timeEntries: JSON.stringify([
      { date: '2026-01-01', hours: 2, billable: true },
      { date: '2026-01-02', hours: 1, billable: false },
    ]),
  };
  assert.deepEqual(projectFinancials(data), {
    tracked: true,
    hours: 3,
    billableHours: 2,
    timeRevenue: 200,
    revenue: 700,
    expenses: 50,
    labour: 120,
    profit: 530,
    margin: 75.71,
  });
  const report = profitReport([
    { id: '1', module: 'projects', title: 'A', status: 'Active', data: { ...data, currency: 'USD' } },
    { id: '2', module: 'projects', title: 'B', status: 'Active', data: { amount: '100', currency: 'EUR' } },
    { id: '3', module: 'projects', title: 'C', status: 'Active', data: { amount: '10', cost: '20', currency: 'USD' } },
    { id: '4', module: 'notes', title: 'x', status: 'Active', data: {} },
  ]);
  assert.deepEqual(report.rows.map((r) => r.id), ['1', '2', '3']);
  assert.deepEqual(report.totals.map((t) => [t.currency, t.projects, t.profit]), [
    ['EUR', 1, 100],
    ['USD', 2, 520],
  ]);
});

test('recurring equipment service advances the due date and closes the work order', () => {
  const data = {
    due: '2026-01-01',
    serviceIntervalDays: '90',
    workOrders: JSON.stringify([
      { id: 'wo-aaaaaaaa', title: 'Oil', status: 'Open', due: '2026-01-01' },
      { id: 'wo-bbbbbbbb', title: 'Belt', status: 'In progress', due: '2027-01-01' },
    ]),
  };
  assert.deepEqual(openWorkOrdersDue(data, '2026-01-02').map((o) => o.id), ['wo-aaaaaaaa']);
  const next = completeService(data, { date: '2026-01-10', workOrderId: 'wo-aaaaaaaa', cost: '25' });
  assert.equal(next.due, '2026-04-10');
  assert.deepEqual(JSON.parse(next.workOrders).map((o) => o.status), ['Done', 'In progress']);
  assert.equal(JSON.parse(next.serviceLog)[0].cost, '25');
  assert.equal(completeService({ due: '2026-05-05' }, { date: '2026-01-10' }).due, '2026-05-05', 'one-off keeps due');
  assert.throws(() => completeService(data, { date: '2026-01-10', workOrderId: 'wo-missing1' }), /no longer/);
});

test('TOTP matches RFC 6238 vectors and allows one step of drift', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(base32Decode(secret).toString(), '12345678901234567890');
  assert.equal(totpCode(secret, Math.floor(59 / 30)), '287082');
  assert.equal(totpCode(secret, Math.floor(1111111109 / 30)), '081804');
  const now = 1111111109000;
  assert.equal(verifyTotp(secret, '081804', -1, now + 30000), Math.floor(1111111109 / 30));
  assert.equal(verifyTotp(secret, '081804', -1, now + 90000), null);
  assert.equal(verifyTotp(secret, '081804', Math.floor(1111111109 / 30), now), null);
});
