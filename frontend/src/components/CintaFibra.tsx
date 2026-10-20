// Cinta con los 12 colores del código TIA-598, en orden de hilo.
// Es la firma visual de la plataforma.

export const COLORES_TIA598 = [
  { nombre: 'Azul', var: 'var(--color-f-azul)' },
  { nombre: 'Naranjo', var: 'var(--color-f-naranjo)' },
  { nombre: 'Verde', var: 'var(--color-f-verde)' },
  { nombre: 'Café', var: 'var(--color-f-cafe)' },
  { nombre: 'Gris', var: 'var(--color-f-gris)' },
  { nombre: 'Blanco', var: 'var(--color-f-blanco)' },
  { nombre: 'Rojo', var: 'var(--color-f-rojo)' },
  { nombre: 'Negro', var: 'var(--color-f-negro)' },
  { nombre: 'Amarillo', var: 'var(--color-f-amarillo)' },
  { nombre: 'Violeta', var: 'var(--color-f-violeta)' },
  { nombre: 'Rosado', var: 'var(--color-f-rosado)' },
  { nombre: 'Aqua', var: 'var(--color-f-aqua)' },
] as const;

type Props = {
  /** horizontal: los hilos corren de izquierda a derecha, uno bajo otro.
   *  vertical: los hilos corren de arriba abajo, uno al lado del otro. */
  sentido?: 'horizontal' | 'vertical';
  grosor?: number;
  separacion?: number;
  className?: string;
};

export function CintaFibra({ sentido = 'horizontal', grosor = 3, separacion = 2, className = '' }: Props) {
  const horizontal = sentido === 'horizontal';
  return (
    <div
      aria-hidden="true"
      className={`flex ${horizontal ? 'flex-col' : 'flex-row'} ${className}`}
      style={{ gap: separacion }}
    >
      {COLORES_TIA598.map((c) => (
        <span
          key={c.nombre}
          className="block rounded-full"
          style={horizontal ? { height: grosor, width: '100%', background: c.var } : { width: grosor, background: c.var }}
        />
      ))}
    </div>
  );
}
