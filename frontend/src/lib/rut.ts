// Utilidades de RUT chileno. Deben coincidir con las funciones
// public.rut_* de la base de datos (que es la validación definitiva).

export function calcularDv(cuerpo: number): string {
  let suma = 0;
  let multiplicador = 2;
  let resto = Math.trunc(cuerpo);
  while (resto > 0) {
    suma += (resto % 10) * multiplicador;
    resto = Math.trunc(resto / 10);
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }
  const dv = 11 - (suma % 11);
  if (dv === 11) return '0';
  if (dv === 10) return 'K';
  return String(dv);
}

/** Lleva cualquier escritura de RUT a "12345678-5". Devuelve null si no tiene forma de RUT. */
export function normalizarRut(entrada: string): string | null {
  const limpio = entrada.replace(/[\s.-]/g, '').toUpperCase();
  if (!/^[0-9]{1,9}[0-9K]$/.test(limpio)) return null;
  const cuerpo = limpio.slice(0, -1).replace(/^0+/, '');
  if (cuerpo === '') return null;
  return `${cuerpo}-${limpio.slice(-1)}`;
}

export function esRutValido(entrada: string): boolean {
  const normal = normalizarRut(entrada);
  if (!normal) return false;
  const [cuerpo, dv] = normal.split('-') as [string, string];
  return calcularDv(Number(cuerpo)) === dv;
}

/** "12345678-5" → "12.345.678-5" */
export function formatearRut(entrada: string): string {
  const normal = normalizarRut(entrada);
  if (!normal) return entrada;
  const [cuerpo, dv] = normal.split('-') as [string, string];
  return `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
}
