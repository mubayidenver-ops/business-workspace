import type { Item } from './types';
import { download } from './lib';

const calendarText = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[,;]/g, '\\$&');
const utc = (value: string) =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

function fold(line: string) {
  let output = '';
  let width = 0;
  const encoder = new TextEncoder();
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (width + bytes > 75) {
      output += '\r\n ';
      width = 1;
    }
    output += char;
    width += bytes;
  }
  return output;
}

export function downloadAppointment(record: Item) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Business Workspace//Appointments//EN',
    'BEGIN:VEVENT',
    'UID:' + record.id + '@business-workspace',
    'DTSTAMP:' + utc(record.updated),
    'DTSTART:' + utc(String(record.data.start)),
    'DTEND:' + utc(String(record.data.end)),
    'SUMMARY:' + calendarText(record.title),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  download('appointment.ics', lines.map(fold).join('\r\n') + '\r\n', 'text/calendar;charset=utf-8');
}
