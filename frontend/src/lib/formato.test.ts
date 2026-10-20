import { describe, expect, it } from 'vitest';
import { formatearClp, formatearFecha, formatearFechaHora, formatearTelefono, mesCorto } from './formato';

describe('formatos', () => {
  it('formatea pesos chilenos sin decimales', () => {
    expect(formatearClp(12990)).toBe('$12.990');
    expect(formatearClp(0)).toBe('$0');
    expect(formatearClp(null)).toBe('—');
  });

  it('formatea fechas en dd-mm-aaaa', () => {
    expect(formatearFecha('2026-03-07')).toBe('07-03-2026');
  });

  it('muestra la hora de Santiago', () => {
    // 15:30 UTC en julio (invierno, UTC-4) = 11:30 en Santiago
    expect(formatearFechaHora('2026-07-01T15:30:00Z')).toBe('01-07-2026 11:30');
  });

  it('formatea teléfono móvil', () => {
    expect(formatearTelefono('+56912345678')).toBe('+56 9 1234 5678');
  });

  it('abrevia meses', () => {
    expect(mesCorto('2026-03')).toBe('mar');
  });
});
