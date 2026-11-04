export function parseCSV(text, delimiter = ',') {
  if (![',', ';', '\t'].includes(delimiter)) throw new Error('Choose a supported delimiter.');
  const rows = [];
  let row = [],
    cell = '',
    quoted = false,
    closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === '"') {
      if (cell || closed) throw new Error('Unexpected quote in a field.');
      quoted = true;
    } else if (c === delimiter) {
      row.push(cell);
      cell = '';
      closed = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      closed = false;
    } else {
      if (closed) throw new Error('Unexpected text after a closing quote.');
      cell += c;
    }
  }
  if (quoted) throw new Error('A quoted field is missing its closing quote.');
  if (cell || row.length || closed) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
export function writeCSV(rows, delimiter = ',') {
  return rows
    .map((row) =>
      row
        .map((value) => {
          let s = String(value ?? '');
          // Defuse spreadsheet formulas when a downloaded file is opened in Excel.
          if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
          return '"' + s.replaceAll('"', '""') + '"';
        })
        .join(delimiter),
    )
    .join('\r\n');
}
export function cleanCSV(text, delimiter = ',') {
  return cleanRows(parseCSV(text, delimiter));
}
export function cleanRows(rows) {
  if (!rows.length) throw new Error('Add a header and at least one row.');
  const header = rows[0].map((c) => c.trim());
  if (header.some((c) => !c)) throw new Error('Every column needs a header.');
  const seen = new Set();
  let duplicates = 0,
    empty = 0;
  const result = [header],
    warnings = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i].map((c) => c.trim());
    if (row.every((c) => !c)) {
      empty++;
      continue;
    }
    if (row.length !== header.length)
      warnings.push(`Row ${i + 1}: ${row.length} fields; expected ${header.length}.`);
    const key = JSON.stringify(row);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    result.push(row);
  }
  return { rows: result, duplicates, empty, warnings };
}
