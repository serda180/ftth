import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { LoaderCircle, TriangleAlert, CircleCheck } from 'lucide-react';

export function Boton({
  variante = 'primario',
  cargando = false,
  className = '',
  children,
  disabled,
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: 'primario' | 'secundario' | 'peligro' | 'texto';
  cargando?: boolean;
}) {
  const estilos = {
    primario: 'bg-acento text-white hover:bg-acento-osc',
    secundario: 'bg-superficie text-tinta border border-linea hover:border-tenue',
    peligro: 'bg-superficie text-error border border-error/40 hover:bg-error hover:text-white',
    texto: 'text-acento hover:underline px-1',
  }[variante];
  return (
    <button
      {...resto}
      disabled={disabled || cargando}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-[15px] font-semibold
        transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${estilos} ${className}`}
    >
      {cargando && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Campo({
  etiqueta,
  ayuda,
  error,
  id,
  ...resto
}: InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; ayuda?: string; error?: string; id: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-tinta">
        {etiqueta}
      </label>
      <input
        id={id}
        {...resto}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : ayuda ? `${id}-ayuda` : undefined}
        className={`rounded-md border bg-superficie px-3 py-2 text-[15px] outline-none
          focus:border-acento focus:ring-2 focus:ring-acento/20
          ${error ? 'border-error' : 'border-linea'}`}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-error">
          {error}
        </p>
      ) : ayuda ? (
        <p id={`${id}-ayuda`} className="text-sm text-tenue">
          {ayuda}
        </p>
      ) : null}
    </div>
  );
}

export function Aviso({ tipo, children }: { tipo: 'error' | 'exito'; children: ReactNode }) {
  const Icono = tipo === 'error' ? TriangleAlert : CircleCheck;
  return (
    <div
      role={tipo === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm
        ${tipo === 'error' ? 'border-error/30 bg-error/5 text-error' : 'border-ok/30 bg-ok/5 text-ok'}`}
    >
      <Icono className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function PantallaCarga() {
  return (
    <div className="grid min-h-dvh place-items-center text-tenue" role="status">
      <LoaderCircle className="size-6 animate-spin" aria-label="Cargando" />
    </div>
  );
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-tenue" role="status">
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      {texto}
    </div>
  );
}

export function EncabezadoPagina({ titulo, detalle, acciones }: { titulo: string; detalle?: string; acciones?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-cond text-[28px] font-semibold leading-tight">{titulo}</h1>
        {detalle && <p className="mt-1 max-w-[70ch] text-tenue">{detalle}</p>}
      </div>
      {acciones}
    </header>
  );
}

export function Selector({
  etiqueta,
  id,
  opciones,
  error,
  ayuda,
  vacio,
  ...resto
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  etiqueta: string;
  id: string;
  opciones: { valor: string | number; texto: string }[];
  error?: string;
  ayuda?: string;
  /** Texto de la opción vacía; si se omite, no hay opción vacía. */
  vacio?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-tinta">
        {etiqueta}
      </label>
      <select
        id={id}
        {...resto}
        aria-invalid={error ? true : undefined}
        className={`rounded-md border bg-superficie px-3 py-2 text-[15px] outline-none
          focus:border-acento focus:ring-2 focus:ring-acento/20 ${error ? 'border-error' : 'border-linea'}`}
      >
        {vacio !== undefined && <option value="">{vacio}</option>}
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
      {error ? (
        <p className="text-sm text-error">{error}</p>
      ) : ayuda ? (
        <p className="text-sm text-tenue">{ayuda}</p>
      ) : null}
    </div>
  );
}

export function AreaTexto({
  etiqueta,
  id,
  ...resto
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & { etiqueta: string; id: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-tinta">
        {etiqueta}
      </label>
      <textarea
        id={id}
        rows={3}
        {...resto}
        className="rounded-md border border-linea bg-superficie px-3 py-2 text-[15px] outline-none focus:border-acento focus:ring-2 focus:ring-acento/20"
      />
    </div>
  );
}

/** Par etiqueta/valor para fichas de solo lectura. */
export function DatoFicha({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_1fr] gap-2 py-1.5 text-[15px]">
      <dt className="text-tenue">{etiqueta}</dt>
      <dd className="min-w-0 break-words">{children ?? '—'}</dd>
    </div>
  );
}

/** Punto de color + texto, para estados en listas y fichas. */
export function Insignia({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      {children}
    </span>
  );
}

/** Controles de paginación simples (anterior/siguiente). */
export function Paginacion({ pagina, total, porPagina, alCambiar }: { pagina: number; total: number; porPagina: number; alCambiar: (p: number) => void }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  return (
    <nav className="mt-4 flex items-center justify-between" aria-label="Paginación">
      <p className="text-sm text-tenue">Página {pagina + 1} de {paginas}</p>
      <div className="flex gap-2">
        <Boton variante="secundario" disabled={pagina === 0} onClick={() => alCambiar(pagina - 1)}>Anterior</Boton>
        <Boton variante="secundario" disabled={pagina + 1 >= paginas} onClick={() => alCambiar(pagina + 1)}>Siguiente</Boton>
      </div>
    </nav>
  );
}
