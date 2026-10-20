// Exportación a CSV compatible con Excel en configuración regional de Chile
// (separador punto y coma, UTF-8 con BOM para que respete tildes y ñ).

export type ColumnaCsv<T> = { titulo: string; valor: (fila: T) => string | number | null | undefined };

function celda(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function aCsv<T>(filas: T[], columnas: ColumnaCsv<T>[]): string {
  const encabezado = columnas.map((c) => celda(c.titulo)).join(';');
  const cuerpo = filas.map((f) => columnas.map((c) => celda(c.valor(f))).join(';'));
  return [encabezado, ...cuerpo].join('\r\n');
}

export function descargarCsv(nombreArchivo: string, contenido: string): void {
  const blob = new Blob(['﻿' + contenido], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Fecha para nombres de archivo: aaaa-mm-dd en hora de Santiago. */
export function fechaArchivo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
}
