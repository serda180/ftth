import { describe, expect, it } from 'vitest';
import { dimensionesAjustadas } from './imagen';

describe('compresión de fotos', () => {
  it('reduce el lado mayor al máximo manteniendo la proporción', () => {
    const r = dimensionesAjustadas(4000, 3000, 1600);
    expect(r.ancho).toBe(1600);
    expect(r.alto).toBe(1200);
  });
  it('no agranda fotos pequeñas', () => {
    const r = dimensionesAjustadas(800, 600, 1600);
    expect(r.ancho).toBe(800);
    expect(r.alto).toBe(600);
  });
});
