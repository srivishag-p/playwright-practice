export function formatDate(date: Date, format = 'YYYY-MM-DD'): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return format
    .replace('YYYY', String(yyyy))
    .replace('MM', mm)
    .replace('DD', dd);
}

export function today(format?: string): string {
  return formatDate(new Date(), format);
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function toISOString(date: Date): string {
  return date.toISOString();
}
