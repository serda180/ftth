import { describe, expect, it } from 'vitest';
import { calcularDv, esRutValido, formatearRut, normalizarRut } from './rut';

describe('RUT', () => {
  it('calcula el dígito verificador como la base de datos', () => {
    expect(calcularDv(12345678)).toBe('5');
    expect(calcularDv(11111111)).toBe('1');
    expect(calcularDv(10000013)).toBe('K');
    expect(calcularDv(1000013)).toBe('0');
  });

  it('normaliza distintas escrituras', () => {
    expect(normalizarRut('12.345.678-5')).toBe('12345678-5');
    expect(normalizarRut(' 10.000.013-k ')).toBe('10000013-K');
    expect(normalizarRut('123456785')).toBe('12345678-5');
    expect(normalizarRut('abc')).toBeNull();
  });

  it('valida el dígito verificador', () => {
    expect(esRutValido('12.345.678-5')).toBe(true);
    expect(esRutValido('12.345.678-9')).toBe(false);
    expect(esRutValido('0-0')).toBe(false);
  });

  it('formatea con puntos', () => {
    expect(formatearRut('123456785')).toBe('12.345.678-5');
    expect(formatearRut('1001-4')).toBe('1.001-4');
  });
});
