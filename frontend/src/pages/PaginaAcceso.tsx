import type { ReactNode } from 'react';
import { CintaFibra } from '../components/CintaFibra';
import { useNombreEmpresa } from '../layout/AppLayout';

/** Marco común para ingresar, recuperar y establecer contraseña. */
export function PaginaAcceso({ titulo, detalle, children }: { titulo: string; detalle?: string; children: ReactNode }) {
  const empresa = useNombreEmpresa();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
      <section className="relative hidden overflow-hidden bg-chaqueta text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div>
          <p className="font-cond text-2xl font-semibold">{empresa}</p>
          <p className="mt-1 text-white/60">Gestión de la red de fibra óptica</p>
        </div>
        {/* Los 12 hilos de un tubo, de borde a borde */}
        <CintaFibra sentido="horizontal" grosor={5} separacion={7} className="-mx-12 my-10" />
        <p className="max-w-[44ch] text-white/60">
          Mapa de la red, NAP y puertos, clientes, instalaciones, órdenes de trabajo e inventario en un solo lugar.
        </p>
      </section>

      <section className="flex flex-col">
        <CintaFibra sentido="horizontal" grosor={2} separacion={0} className="lg:hidden" />
        <div className="flex flex-1 items-center justify-center px-5 py-10">
          <div className="w-full max-w-[380px]">
            <p className="font-cond text-lg font-semibold text-tenue lg:hidden">{empresa}</p>
            <h1 className="mt-1 font-cond text-[30px] font-semibold leading-tight">{titulo}</h1>
            {detalle && <p className="mt-2 text-tenue">{detalle}</p>}
            <div className="mt-8">{children}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
