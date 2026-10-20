import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cablesCercanos,
  caminoNap,
  conectarNap,
  confirmarConexion,
  eliminarConexion,
  inyectarHilo,
  inyeccionesDePon,
  type HiloCercano,
} from '../red/api';
import { RutaCadena } from '../red/RutaCadena';
import { COLOR_HILO } from './tipos';
import { formatearDistancia } from './geo';
import { mensajeError } from '../lib/errores';
import { Aviso, Boton, Cargando } from '../components/ui';

function useRefrescarRed() {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries({ queryKey: ['mapa'] });
    await qc.invalidateQueries({ queryKey: ['red'] });
  };
}

/**
 * Alimentación de una NAP: muestra la ruta registrada hasta la OLT y, para el
 * supervisor, permite registrar el hilo que la alimenta, verificarlo o quitarlo.
 */
export function AlimentacionNap({ napId, puedeEditar }: { napId: string; puedeEditar: boolean }) {
  const refrescar = useRefrescarRed();
  const camino = useQuery({ queryKey: ['red', 'camino', napId], queryFn: () => caminoNap(napId) });
  const [eligiendo, setEligiendo] = useState(false);
  const alimentacion = camino.data?.pasos.find((p) => p.tipo === 'hilo');

  const confirmar = useMutation({
    mutationFn: (v: { id: string; ok: boolean }) => confirmarConexion(v.id, v.ok),
    onSuccess: refrescar,
  });
  const quitar = useMutation({
    mutationFn: (id: string) => eliminarConexion(id),
    onSuccess: refrescar,
  });
  const conectar = useMutation({
    mutationFn: (v: { hilo: string; confirmada: boolean }) => conectarNap(napId, v.hilo, v.confirmada),
    onSuccess: async () => {
      setEligiendo(false);
      await refrescar();
    },
  });

  if (camino.isPending) return <Cargando />;
  if (camino.isError) return <Aviso tipo="error">{mensajeError(camino.error)}</Aviso>;

  return (
    <div>
      {camino.data && <RutaCadena camino={camino.data} />}
      {puedeEditar && (
        <div className="mt-3 flex flex-wrap gap-2">
          {alimentacion && alimentacion.tipo === 'hilo' ? (
            <>
              <Boton variante="secundario" className="px-3 py-1.5 text-sm" cargando={confirmar.isPending}
                onClick={() => confirmar.mutate({ id: alimentacion.conexion_id, ok: !alimentacion.confirmada })}>
                {alimentacion.confirmada ? 'Marcar como no verificada' : 'Marcar verificada en terreno'}
              </Boton>
              <Boton variante="peligro" className="px-3 py-1.5 text-sm" cargando={quitar.isPending}
                onClick={() => window.confirm('¿Quitar la alimentación registrada de esta NAP?') && quitar.mutate(alimentacion.conexion_id)}>
                Quitar alimentación
              </Boton>
            </>
          ) : (
            !eligiendo && (
              <Boton className="px-3 py-1.5 text-sm" onClick={() => setEligiendo(true)}>Registrar alimentación</Boton>
            )
          )}
        </div>
      )}
      {(confirmar.isError || quitar.isError) && (
        <div className="mt-2"><Aviso tipo="error">{mensajeError(confirmar.error ?? quitar.error)}</Aviso></div>
      )}
      {eligiendo && (
        <SelectorHilo
          elementoId={napId}
          titulo="¿Qué hilo alimenta esta NAP?"
          disponible={(h) => !h.alimenta && h.estado !== 'danado' && h.estado !== 'reservado'}
          motivo={(h) => (h.alimenta ? `alimenta ${h.alimenta}` : h.estado === 'danado' ? 'dañado' : h.estado === 'reservado' ? 'reservado' : null)}
          enviando={conectar.isPending}
          error={conectar.isError ? mensajeError(conectar.error) : ''}
          alElegir={(hilo, confirmada) => conectar.mutate({ hilo, confirmada })}
          alCancelar={() => setEligiendo(false)}
        />
      )}
    </div>
  );
}

/** Hilos que recibe un puerto PON de la OLT, con alta y baja. */
export function InyeccionesPon({ ponId, oltId, etiqueta, puedeEditar }: { ponId: string; oltId: string; etiqueta: string; puedeEditar: boolean }) {
  const refrescar = useRefrescarRed();
  const lista = useQuery({ queryKey: ['red', 'inyecciones', ponId], queryFn: () => inyeccionesDePon(ponId) });
  const [eligiendo, setEligiendo] = useState(false);
  const quitar = useMutation({ mutationFn: (id: string) => eliminarConexion(id), onSuccess: refrescar });
  const confirmar = useMutation({
    mutationFn: (v: { id: string; ok: boolean }) => confirmarConexion(v.id, v.ok),
    onSuccess: refrescar,
  });
  const inyectar = useMutation({
    mutationFn: (v: { hilo: string; confirmada: boolean }) => inyectarHilo(ponId, v.hilo, v.confirmada),
    onSuccess: async () => {
      setEligiendo(false);
      await refrescar();
    },
  });

  return (
    <div className="mt-2 rounded-md border border-linea p-3">
      <p className="mb-2 font-medium">{etiqueta}</p>
      {lista.isPending && <Cargando />}
      {lista.data?.length === 0 && <p className="text-sm text-tenue">Este puerto no inyecta ningún hilo registrado.</p>}
      <ul className="flex flex-col gap-1.5">
        {lista.data?.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-full border border-linea" style={{ background: COLOR_HILO[x.hilo?.color ?? ''] ?? '#ccc' }} aria-hidden />
              {x.hilo?.cables?.codigo} · hilo {x.hilo?.numero}
              {!x.confirmada && <span className="text-tenue">(sin verificar)</span>}
            </span>
            {puedeEditar && (
              <span className="flex gap-2">
                <button type="button" className="text-acento hover:underline" onClick={() => confirmar.mutate({ id: x.id, ok: !x.confirmada })}>
                  {x.confirmada ? 'No verificada' : 'Verificar'}
                </button>
                <button type="button" className="text-error hover:underline"
                  onClick={() => window.confirm('¿Quitar esta conexión?') && quitar.mutate(x.id)}>
                  Quitar
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {(quitar.isError || confirmar.isError) && <Aviso tipo="error">{mensajeError(quitar.error ?? confirmar.error)}</Aviso>}
      {puedeEditar && !eligiendo && (
        <Boton variante="secundario" className="mt-2 px-3 py-1.5 text-sm" onClick={() => setEligiendo(true)}>Agregar hilo</Boton>
      )}
      {eligiendo && (
        <SelectorHilo
          elementoId={oltId}
          titulo={`¿Qué hilo recibe la señal de ${etiqueta}?`}
          disponible={(h) => !h.inyectado && h.estado !== 'danado'}
          motivo={(h) => (h.inyectado ? `ya en ${h.inyectado}` : h.estado === 'danado' ? 'dañado' : null)}
          enviando={inyectar.isPending}
          error={inyectar.isError ? mensajeError(inyectar.error) : ''}
          alElegir={(hilo, confirmada) => inyectar.mutate({ hilo, confirmada })}
          alCancelar={() => setEligiendo(false)}
        />
      )}
    </div>
  );
}

/** Elige un hilo de los cables que pasan cerca de un elemento. */
function SelectorHilo({
  elementoId,
  titulo,
  disponible,
  motivo,
  enviando,
  error,
  alElegir,
  alCancelar,
}: {
  elementoId: string;
  titulo: string;
  disponible: (h: HiloCercano) => boolean;
  motivo: (h: HiloCercano) => string | null;
  enviando: boolean;
  error: string;
  alElegir: (hiloId: string, confirmada: boolean) => void;
  alCancelar: () => void;
}) {
  const cables = useQuery({ queryKey: ['red', 'cables-cercanos', elementoId], queryFn: () => cablesCercanos(elementoId) });
  const [cableId, setCableId] = useState<string | null>(null);
  const [hiloId, setHiloId] = useState<string | null>(null);
  const [confirmada, setConfirmada] = useState(false);
  const cable = cables.data?.find((c) => c.id === cableId) ?? cables.data?.[0];

  return (
    <div className="mt-3 rounded-md border border-linea bg-fondo/50 p-3">
      <p className="mb-2 font-medium">{titulo}</p>
      {cables.isPending && <Cargando texto="Buscando cables cercanos…" />}
      {cables.isError && <Aviso tipo="error">{mensajeError(cables.error)}</Aviso>}
      {cables.data?.length === 0 && (
        <p className="text-sm text-tenue">No hay cables que pasen a menos de 60 m. Dibuje primero el cable en el mapa.</p>
      )}
      {cables.data && cables.data.length > 0 && cable && (
        <>
          <label htmlFor="sel-cable" className="text-sm font-medium">Cable</label>
          <select
            id="sel-cable"
            value={cable.id}
            onChange={(e) => {
              setCableId(e.target.value);
              setHiloId(null);
            }}
            className="mb-3 mt-1 w-full rounded-md border border-linea bg-superficie px-3 py-2"
          >
            {cables.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.codigo} ({c.tipo}, a {formatearDistancia(c.distancia_m)})
              </option>
            ))}
          </select>
          <p className="mb-1 text-sm font-medium">Hilo</p>
          <ul className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
            {cable.hilos.map((h) => {
              const ok = disponible(h);
              const razon = motivo(h);
              return (
                <li key={h.id}>
                  <button
                    type="button"
                    disabled={!ok}
                    onClick={() => setHiloId(h.id)}
                    aria-pressed={hiloId === h.id}
                    title={`Hilo ${h.numero} (${h.color}, tubo ${h.tubo})${razon ? `: ${razon}` : ''}`}
                    className={`cifra grid aspect-square w-full place-items-center rounded-full border text-xs font-semibold disabled:opacity-30
                      ${hiloId === h.id ? 'ring-2 ring-tinta ring-offset-1' : ''}`}
                    style={{
                      background: COLOR_HILO[h.color] ?? '#ccc',
                      borderColor: h.color === 'Blanco' ? '#cfd7dc' : 'transparent',
                      color: ['Blanco', 'Amarillo', 'Rosado', 'Aqua', 'Gris'].includes(h.color) ? '#17232c' : '#fff',
                    }}
                  >
                    {h.numero}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-xs text-tenue">Los hilos atenuados no están disponibles (en uso, dañados o reservados).</p>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--color-acento)]" checked={confirmada} onChange={(e) => setConfirmada(e.target.checked)} />
            Verificada en terreno
          </label>
        </>
      )}
      {error && <div className="mt-2"><Aviso tipo="error">{error}</Aviso></div>}
      <div className="mt-3 flex gap-2">
        <Boton className="px-3 py-1.5 text-sm" disabled={!hiloId} cargando={enviando} onClick={() => hiloId && alElegir(hiloId, confirmada)}>
          Guardar conexión
        </Boton>
        <Boton variante="secundario" className="px-3 py-1.5 text-sm" onClick={alCancelar}>Cancelar</Boton>
      </div>
    </div>
  );
}
