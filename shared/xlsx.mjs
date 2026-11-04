// Minimal, dependency-free XLSX reader: unzips the workbook in the browser (or Node 18+) and
// extracts cell text from each worksheet. Formulas yield their cached values.
const td = new TextDecoder();
async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('This file is not a valid .xlsx workbook.');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('The workbook is damaged.');
    const method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extra = view.getUint16(offset + 30, true);
    const comment = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = td.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extra + comment;
    const dataStart =
      local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    files.set(name, { method, data: bytes.subarray(dataStart, dataStart + size) });
  }
  return {
    has: (name) => files.has(name),
    async text(name) {
      const f = files.get(name);
      if (!f) return null;
      if (f.method === 0) return td.decode(f.data);
      if (f.method === 8) return td.decode(await inflate(f.data));
      throw new Error('This workbook uses an unsupported compression method.');
    },
  };
}
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    if (e[0] === '#')
      return String.fromCodePoint(
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1),
      );
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
  });
const attr = (tag, name) => {
  const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag);
  return m ? decode(m[1]) : null;
};
const textOf = (xml) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');
const columnIndex = (ref) => {
  let n = 0;
  for (const c of /^[A-Z]+/.exec(ref)?.[0] || '') n = n * 26 + c.charCodeAt(0) - 64;
  return n - 1;
};
function dateFormats(styles) {
  if (!styles) return new Set();
  const custom = new Map(
    [...styles.matchAll(/<numFmt\s[^>]*>/g)].map((m) => [
      Number(attr(m[0], 'numFmtId')),
      attr(m[0], 'formatCode') || '',
    ]),
  );
  const isDate = (id) =>
    (id >= 14 && id <= 22) ||
    (id >= 45 && id <= 47) ||
    (custom.has(id) && /[dmy]/i.test(custom.get(id).replace(/\[[^\]]*\]|"[^"]*"/g, '')));
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] || '';
  const result = new Set();
  [...xfs.matchAll(/<xf\s[^>]*?\/?>/g)].forEach((m, index) => {
    if (isDate(Number(attr(m[0], 'numFmtId')))) result.add(index);
  });
  return result;
}
function excelDate(serial) {
  const ms = Math.round((serial - 25569) * 86400000);
  const iso = new Date(ms).toISOString();
  return serial % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
}
export async function readXlsx(input, { maxRows = 20000, maxColumns = 200 } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const zip = await unzip(bytes);
  const workbook = await zip.text('xl/workbook.xml');
  if (!workbook) throw new Error('This file is not a valid .xlsx workbook.');
  const rels = (await zip.text('xl/_rels/workbook.xml.rels')) || '';
  const targets = new Map(
    [...rels.matchAll(/<Relationship\s[^>]*>/g)].map((m) => [
      attr(m[0], 'Id'),
      attr(m[0], 'Target'),
    ]),
  );
  const shared = [
    ...((await zip.text('xl/sharedStrings.xml')) || '').matchAll(/<si>([\s\S]*?)<\/si>/g),
  ].map((m) => textOf(m[1]));
  const dates = dateFormats(await zip.text('xl/styles.xml'));
  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\s[^>]*>/g)) {
    const name = attr(m[0], 'name') || 'Sheet';
    let target = targets.get(attr(m[0], 'r:id')) || '';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const xml = await zip.text(target);
    if (!xml) continue;
    const rows = [];
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
      if (rows.length >= maxRows) throw new Error(`Sheets are limited to ${maxRows} rows.`);
      const rowNumber = Number(attr(r[0], 'r')) || rows.length + 1;
      while (rows.length < rowNumber - 1) rows.push([]);
      const row = [];
      for (const c of (r[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(c[0], 'r');
        const col = ref ? columnIndex(ref) : row.length;
        if (col >= maxColumns) throw new Error(`Sheets are limited to ${maxColumns} columns.`);
        const type = attr(c[0], 't');
        const body = c[2] || '';
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value = '';
        if (type === 's') value = shared[Number(raw)] ?? '';
        else if (type === 'inlineStr') value = textOf(body);
        else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
        else if (type === 'str' || type === 'e') value = raw === undefined ? '' : decode(raw);
        else if (raw !== undefined) {
          const style = Number(attr(c[0], 's') || 0);
          value = dates.has(style) && Number.isFinite(Number(raw)) ? excelDate(Number(raw)) : raw;
        }
        while (row.length < col) row.push('');
        row[col] = value;
      }
      rows.push(row);
    }
    while (rows.length && rows[rows.length - 1].every((v) => !v)) rows.pop();
    const width = Math.max(0, ...rows.map((row) => row.length));
    sheets.push({ name, rows: rows.map((row) => [...row, ...Array(width - row.length).fill('')]) });
  }
  if (!sheets.length) throw new Error('This workbook has no readable sheets.');
  return sheets;
}
