// Formatos de presentación para Chile.

const ZONA = 'America/Santiago';

const clp = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});
const entero = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const decimal1 = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** 12990 → "$12.990" */
export function formatearClp(valor: number | null | undefined): string {
  if (valor == null) return '—';
  return clp.format(valor).replace(/\s/g, '');
}

export function formatearEntero(valor: number | null | undefined): string {
  return valor == null ? '—' : entero.format(valor);
}

export function formatearDecimal(valor: number | null | undefined): string {
  return valor == null ? '—' : decimal1.format(valor);
}

function partes(fecha: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('es-CL', {
    timeZone: ZONA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(fecha)) {
    out[p.type] = p.value;
  }
  return out;
}

/** Fecha y hora en Santiago como "dd-mm-aaaa HH:mm". */
export function formatearFechaHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const p = partes(new Date(iso));
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}`;
}

/** Solo la fecha, "dd-mm-aaaa". Acepta "aaaa-mm-dd" (columna date) o ISO completo. */
export function formatearFecha(valor: string | null | undefined): string {
  if (!valor) return '—';
  const soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (soloFecha) return `${soloFecha[3]}-${soloFecha[2]}-${soloFecha[1]}`;
  const p = partes(new Date(valor));
  return `${p.day}-${p.month}-${p.year}`;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "2026-03" → "mar" */
export function mesCorto(aaaamm: string): string {
  const m = Number(aaaamm.slice(5, 7));
  return MESES[m - 1] ?? aaaamm;
}

/** "+56912345678" → "+56 9 1234 5678" */
export function formatearTelefono(valor: string | null | undefined): string {
  if (!valor) return '—';
  const m = /^\+56(9)(\d{4})(\d{4})$/.exec(valor);
  if (m) return `+56 ${m[1]} ${m[2]} ${m[3]}`;
  return valor;
}
