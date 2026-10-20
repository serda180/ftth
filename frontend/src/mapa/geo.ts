// Cálculos geográficos simples en el navegador (los definitivos los hace PostGIS).
import type { Coordenada } from './tipos';

const RADIO_TIERRA_M = 6371008.8;

/** Distancia en metros entre dos puntos [lng, lat] (haversine). */
export function distanciaM(a: Coordenada, b: Coordenada): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.sqrt(h));
}

/** Longitud total de una línea en metros. */
export function longitudM(coordenadas: Coordenada[]): number {
  let total = 0;
  for (let i = 1; i < coordenadas.length; i++) total += distanciaM(coordenadas[i - 1]!, coordenadas[i]!);
  return total;
}

/** "850 m" o "1,25 km" */
export function formatearDistancia(m: number): string {
  if (m < 1000) return `${Math.round(m).toLocaleString('es-CL')} m`;
  return `${(m / 1000).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
}

/** Elementos ordenados por cercanía a un punto, dentro de un radio. */
export function masCercanos<T extends { lng: number; lat: number }>(
  punto: Coordenada,
  elementos: T[],
  radioM: number,
  limite = 10,
): (T & { distancia: number })[] {
  return elementos
    .map((e) => ({ ...e, distancia: distanciaM(punto, [e.lng, e.lat]) }))
    .filter((e) => e.distancia <= radioM)
    .sort((a, b) => a.distancia - b.distancia)
    .slice(0, limite);
}
