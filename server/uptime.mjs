import { randomUUID } from 'node:crypto';
export function uptimeResult(record, result, previous, created) {
  const monitorUrl = JSON.parse(record.data).url;
  const incident = previous?.monitorUrl === monitorUrl ? previous.incident : undefined;
  if (result.ok === false) {
    if (incident && !incident.closed) return { ...result, monitorUrl, incident };
    return {
      ...result,
      monitorUrl,
      incident: { id: randomUUID(), opened: created },
      transition: 'outage',
    };
  }
  if (result.ok === true && incident && !incident.closed) {
    return {
      ...result,
      monitorUrl,
      incident: { ...incident, closed: created },
      transition: 'recovery',
    };
  }
  return { ...result, monitorUrl };
}
export function checkInterval(record) {
  return (
    (record.module === 'uptime' ? Number(JSON.parse(record.data).intervalMinutes) || 5 : 5) * 60000
  );
}
