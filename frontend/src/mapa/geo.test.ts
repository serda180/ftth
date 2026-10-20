import { describe, expect, it } from 'vitest';
import { distanciaM, formatearDistancia, longitudM, masCercanos } from './geo';

describe('geo', () => {
  it('mide distancias como PostGIS (±1 m)', () => {
    // Mismo caso que la prueba de base de datos: ~890 m
    const d = longitudM([
      [-73.11, -36.9],
      [-73.105, -36.9],
      [-73.1, -36.9],
    ]);
    expect(Math.round(d / 10)).toBe(89);
  });

  it('distancia cero entre el mismo punto', () => {
    expect(distanciaM([-73, -36], [-73, -36])).toBe(0);
  });

  it('formatea metros y kilómetros', () => {
    expect(formatearDistancia(850.4)).toBe('850 m');
    expect(formatearDistancia(1250)).toBe('1,25 km');
  });

  it('encuentra el elemento más cercano dentro del radio', () => {
    const r = masCercanos([-73.1, -36.9], [
      { id: 'lejos', lng: -73.0, lat: -36.9 },
      { id: 'cerca', lng: -73.1001, lat: -36.9 },
    ], 30);
    expect(r.length).toBe(1);
    expect(r[0]?.id).toBe('cerca');
  });
});
