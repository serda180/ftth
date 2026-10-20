import { useQuery } from '@tanstack/react-query';
import { Pencil, Spline, Trash2 } from 'lucide-react';
import { fichaCable } from './api';
import { COLOR_HILO, TIPOS_CABLE, type FichaCable, type HiloFicha } from './tipos';
import { formatearDistancia } from './geo';
import { mensajeError } from '../lib/errores';
import { formatearFecha } from '../lib/formato';
import { Aviso, Boton, Cargando, DatoFicha } from '../components/ui';
import { InsigniaEstado } from './FichaElementoPanel';

const ESTADO_HILO: Record<HiloFicha['estado'], string> = {
  libre: 'Libre',
  en_uso: 'En uso',
  reservado: 'Reservado',
  danado: 'Dañado',
};

export function FichaCablePanel({
  id,
  puedeEditar,
  eliminando,
  alEditarDatos,
  alEditarTrazado,
  alEliminar,
  alVerElemento,
}: {
  id: string;
  puedeEditar: boolean;
  eliminando: boolean;
  alEditarDatos: (f: FichaCable) => void;
  alEditarTrazado: (f: FichaCable) => void;
  alEliminar: (f: FichaCable) => void;
  alVerElemento: (id: string) => void;
}) {
  const ficha = useQuery({ queryKey: ['mapa', 'ficha-cable', id], queryFn: () => fichaCable(id) });

  if (ficha.isPending) return <Cargando />;
  if (ficha.isError) return <Aviso tipo="error">{mensajeError(ficha.error)}</Aviso>;
  const f = ficha.data;
  if (!f) return <p className="text-tenue">Este cable ya no existe.</p>;

  const tipo = TIPOS_CABLE.find((t) => t.valor === f.tipo);
  const usados = f.hilos.filter((h) => h.estado !== 'libre').length;
  const tubos = [...new Set(f.hilos.map((h) => h.tubo))];

  return (
    <article>
      <header>
        <p className="flex items-center gap-2 text-sm text-tenue">
          <span className="block w-5" style={{ borderTop: `${tipo?.grosor ?? 3}px solid ${tipo?.color}` }} aria-hidden />
          Cable {tipo?.nombre.toLowerCase()}
        </p>
        <h2 className="font-cond text-2xl font-semibold leading-tight">{f.codigo}</h2>
        {f.nombre_tramo && <p className="mt-0.5">{f.nombre_tramo}</p>}
        <p className="mt-2 flex flex-wrap gap-2 text-sm">
          <InsigniaEstado estado={f.estado} />
          {f.es_demo && <span className="rounded bg-f-amarillo/25 px-2 py-0.5">Dato de demostración</span>}
        </p>
      </header>

      {puedeEditar && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Boton variante="secundario" className="px-3 py-1.5 text-sm" onClick={() => alEditarDatos(f)}>
            <Pencil className="size-4" aria-hidden /> Editar datos
          </Boton>
          <Boton variante="secundario" className="px-3 py-1.5 text-sm" onClick={() => alEditarTrazado(f)}>
            <Spline className="size-4" aria-hidden /> Editar trazado
          </Boton>
          <Boton variante="peligro" className="px-3 py-1.5 text-sm" cargando={eliminando} onClick={() => alEliminar(f)}>
            {!eliminando && <Trash2 className="size-4" aria-hidden />} Eliminar
          </Boton>
        </div>
      )}

      <section className="mt-6">
        <dl>
          <DatoFicha etiqueta="Origen">
            {f.origen ? (
              <button type="button" className="text-acento hover:underline" onClick={() => alVerElemento(f.origen!.id)}>
                {f.origen.codigo}
              </button>
            ) : (
              'Sin elemento de origen'
            )}
          </DatoFicha>
          <DatoFicha etiqueta="Destino">
            {f.destino ? (
              <button type="button" className="text-acento hover:underline" onClick={() => alVerElemento(f.destino!.id)}>
                {f.destino.codigo}
              </button>
            ) : (
              'Sin elemento de destino'
            )}
          </DatoFicha>
          <DatoFicha etiqueta="Modelo">{f.modelo}</DatoFicha>
          <DatoFicha etiqueta="Fibras">
            <span className="cifra">
              {usados} en uso de {f.cantidad_fibras} ({f.cantidad_fibras - usados} disponibles)
            </span>
          </DatoFicha>
          <DatoFicha etiqueta="Largo en el mapa">
            <span className="cifra">{formatearDistancia(Number(f.longitud_mapa_m))}</span>
          </DatoFicha>
          <DatoFicha etiqueta="Largo declarado">
            {f.longitud_declarada_m != null ? (
              <span className="cifra">{formatearDistancia(Number(f.longitud_declarada_m))}</span>
            ) : null}
          </DatoFicha>
          <DatoFicha etiqueta="Instalación">{f.fecha_instalacion ? formatearFecha(f.fecha_instalacion) : null}</DatoFicha>
          <DatoFicha etiqueta="Observaciones">{f.observaciones}</DatoFicha>
        </dl>
      </section>

      <section className="mt-6">
        <h3 className="mb-2 font-cond text-lg font-semibold">Hilos</h3>
        {tubos.map((t) => (
          <div key={t} className="mb-3">
            {tubos.length > 1 && <p className="mb-1 text-sm text-tenue">Tubo {t}</p>}
            <ul className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
              {f.hilos
                .filter((h) => h.tubo === t)
                .map((h) => (
                  <li key={h.id}>
                    <span
                      title={`Hilo ${h.numero} (${h.color}): ${ESTADO_HILO[h.estado]}${h.nap ? ` → ${h.nap.codigo}` : ''}`}
                      className={`cifra relative grid aspect-square place-items-center rounded-full border text-xs font-semibold
                        ${h.estado === 'libre' ? 'opacity-45' : ''}`}
                      style={{
                        background: COLOR_HILO[h.color] ?? '#ccc',
                        borderColor: h.color === 'Blanco' ? '#cfd7dc' : 'transparent',
                        color: ['Blanco', 'Amarillo', 'Rosado', 'Aqua', 'Gris'].includes(h.color) ? '#17232c' : '#fff',
                      }}
                    >
                      {h.numero}
                      {h.estado === 'danado' && (
                        <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-superficie bg-error" aria-hidden />
                      )}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
        <p className="text-sm text-tenue">Los hilos atenuados están libres; el punto rojo marca un hilo dañado.</p>
        {f.hilos.some((h) => h.nap) && (
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {f.hilos
              .filter((h) => h.nap)
              .map((h) => (
                <li key={h.id}>
                  Hilo {h.numero} ({h.color}) →{' '}
                  <button type="button" className="text-acento hover:underline" onClick={() => alVerElemento(h.nap!.id)}>
                    {h.nap!.codigo}
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>
    </article>
  );
}
