import { describe, expect, it } from 'vitest';
import { aCsv } from './csv';

describe('CSV', () => {
  it('usa punto y coma y escapa comillas, separadores y saltos de línea', () => {
    const csv = aCsv(
      [
        { nombre: 'Ana; Pérez', obs: 'dijo "hola"', monto: 14990 },
        { nombre: 'Luis', obs: null, monto: 0 },
      ],
      [
        { titulo: 'Nombre', valor: (f) => f.nombre },
        { titulo: 'Observaciones', valor: (f) => f.obs },
        { titulo: 'Monto', valor: (f) => f.monto },
      ],
    );
    expect(csv).toBe('Nombre;Observaciones;Monto\r\n"Ana; Pérez";"dijo ""hola""";14990\r\nLuis;;0');
  });
});
