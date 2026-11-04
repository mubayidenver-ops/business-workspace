export async function api<T = unknown>(path: string, method = 'GET', value?: unknown): Promise<T> {
  const response = await fetch('/api' + path, {
    method,
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value),
    signal: AbortSignal.timeout(70000),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.error || 'The request could not be completed.'), {
      status: response.status,
      twoFactorRequired: data.twoFactorRequired === true,
    });
  return data;
}
export function download(name: string, content: string | Blob, type = 'text/plain') {
  const url = URL.createObjectURL(
    content instanceof Blob ? content : new Blob([content], { type }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function money(value: unknown, currency: unknown = 'USD') {
  try {
    return new Intl.NumberFormat(navigator.language, {
      style: 'currency',
      currency: String(currency || 'USD'),
    }).format(Number(value) || 0);
  } catch {
    return String(value);
  }
}
export function date(value: string) {
  return new Intl.DateTimeFormat(navigator.language, { dateStyle: 'medium' }).format(
    new Date(value.length === 10 ? value + 'T12:00:00' : value),
  );
}
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
