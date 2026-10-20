import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
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
