import { CLASES, ESTADOS, TIPOS_CABLE, estiloCable, type Clase, type EstadoElemento, type Filtros, type TipoCable } from './tipos';
import { svgClase } from './simbolos';
import type { Catalogos } from './api';

/** Capas, filtros y leyenda en un solo panel: cada casilla muestra su símbolo. */
export function PanelCapas({
  filtros,
  catalogos,
  alCambiar,
  mostrarClientes,
}: {
  filtros: Filtros;
  catalogos: Catalogos;
  alCambiar: (f: Filtros) => void;
  /** Solo los roles que pueden ver clientes tienen esta capa. */
  mostrarClientes: boolean;
}) {
  function alternar<T>(lista: T[], valor: T): T[] {
    return lista.includes(valor) ? lista.filter((x) => x !== valor) : [...lista, valor];
  }
  const colorClase = (c: Clase) => catalogos.tipos.find((t) => t.clase === c)?.color ?? '#64748b';

  return (
    <div className="flex flex-col gap-5 text-[15px]">
      <fieldset>
        <legend className="mb-1.5 font-cond text-base font-semibold">Elementos</legend>
        <ul className="flex flex-col gap-0.5">
          {CLASES.map((c) => (
            <li key={c.valor}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded px-1 py-1 hover:bg-fondo">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-acento)]"
                  checked={filtros.clases.includes(c.valor)}
                  onChange={() => alCambiar({ ...filtros, clases: alternar(filtros.clases, c.valor) })}
                />
                <span
                  className="grid size-5 place-items-center"
                  aria-hidden
                  dangerouslySetInnerHTML={{ __html: svgClase(c.valor, colorClase(c.valor)) }}
                />
                {c.nombre}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset>
        <legend className="mb-1.5 font-cond text-base font-semibold">Cables y otras capas</legend>
        <ul className="flex flex-col gap-0.5">
          {TIPOS_CABLE.map((t) => (
            <li key={t.valor}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded px-1 py-1 hover:bg-fondo">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-acento)]"
                  checked={filtros.tiposCable.includes(t.valor)}
                  onChange={() =>
                    alCambiar({ ...filtros, tiposCable: alternar<TipoCable>(filtros.tiposCable, t.valor) })
                  }
                />
                <span className="block h-0 w-5 rounded" style={{ borderTop: `${t.grosor}px solid ${t.color}` }} aria-hidden />
                {t.nombre}
              </label>
            </li>
          ))}
          <li>
            <label className="flex cursor-pointer items-center gap-2.5 rounded px-1 py-1 hover:bg-fondo">
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-acento)]"
                checked={filtros.zonas}
                onChange={() => alCambiar({ ...filtros, zonas: !filtros.zonas })}
              />
              <span className="block h-3 w-5 rounded-sm border border-dashed border-f-aqua bg-f-aqua/10" aria-hidden />
              Zonas de cobertura
            </label>
          </li>
          {mostrarClientes && (
            <li>
              <label className="flex cursor-pointer items-center gap-2.5 rounded px-1 py-1 hover:bg-fondo">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-acento)]"
                  checked={filtros.clientes}
                  onChange={() => alCambiar({ ...filtros, clientes: !filtros.clientes })}
                />
                <span className="block size-3 rounded-full border-2 border-white bg-ok shadow" aria-hidden />
                Clientes (desde zoom 16)
              </label>
            </li>
          )}
        </ul>
      </fieldset>

      <fieldset>
        <legend className="mb-1.5 font-cond text-base font-semibold">Estado</legend>
        <ul className="flex flex-col gap-0.5">
          {ESTADOS.map((e) => {
            const muestra = estiloCable('troncal', e.valor);
            return (
              <li key={e.valor}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded px-1 py-1 hover:bg-fondo">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-acento)]"
                    checked={filtros.estados.includes(e.valor)}
                    onChange={() =>
                      alCambiar({ ...filtros, estados: alternar<EstadoElemento>(filtros.estados, e.valor) })
                    }
                  />
                  <svg width="20" height="8" aria-hidden>
                    <line
                      x1="1" y1="4" x2="19" y2="4"
                      stroke={muestra.color}
                      strokeWidth="3"
                      strokeDasharray={muestra.dashArray}
                      strokeLinecap="round"
                      opacity={muestra.opacity}
                    />
                  </svg>
                  {e.nombre}
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-sector" className="font-cond text-base font-semibold">
          Sector
        </label>
        <input
          id="filtro-sector"
          type="search"
          placeholder="Todos los sectores"
          value={filtros.sector}
          onChange={(ev) => alCambiar({ ...filtros, sector: ev.target.value })}
          className="rounded-md border border-linea bg-superficie px-3 py-2 outline-none focus:border-acento"
        />
      </div>

      <div className="border-t border-linea pt-4 text-sm text-tenue">
        <p className="mb-2 font-medium text-tinta">Ocupación de NAP (anillo)</p>
        <ul className="flex flex-col gap-1">
          <li className="flex items-center gap-2"><span className="size-3 rounded-full border-2 border-ok" aria-hidden /> Menos de 50 %</li>
          <li className="flex items-center gap-2"><span className="size-3 rounded-full border-2 border-alerta" aria-hidden /> Desde 50 %</li>
          <li className="flex items-center gap-2"><span className="size-3 rounded-full border-2 border-error" aria-hidden /> Desde {catalogos.umbralOcupacion} % (alerta)</li>
        </ul>
        <p className="mt-3">
          Los elementos planificados o en construcción se ven atenuados; los fuera de servicio, con borde rojo
          punteado.
        </p>
      </div>
    </div>
  );
}
