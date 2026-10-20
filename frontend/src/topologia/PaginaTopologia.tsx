import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { TriangleAlert } from 'lucide-react';
import { cargarTopologia, type NapTopologia, type PasoCamino, type Topologia } from '../red/api';
import { ImpactoPanel } from '../red/ImpactoPanel';
import { RutaCadena } from '../red/RutaCadena';
import { COLOR_HILO } from '../mapa/tipos';
import { supabase } from '../lib/supabase';
import { mensajeError } from '../lib/errores';
import { Aviso, Cargando, EncabezadoPagina, Selector } from '../components/ui';

type Analisis = { tipo: 'cable' | 'elemento' | 'pon'; id: string; nombre: string } | null;

const caido = (p: PasoCamino) =>
  (p.tipo === 'nap' && p.estado === 'fuera_servicio') ||
  (p.tipo === 'hilo' && (p.cable_estado === 'fuera_servicio' || p.estado === 'danado')) ||
  (p.tipo === 'pon' && p.olt_estado === 'fuera_servicio') ||
  (p.tipo === 'splitter' && p.estado === 'fuera_servicio');

export function PaginaTopologia() {
  const topo = useQuery({ queryKey: ['red', 'topologia'], queryFn: cargarTopologia });
  const cables = useQuery({
    queryKey: ['red', 'cables-lista'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cables')
        .select('id, codigo, tipo, estado')
        .is('eliminado_en', null)
        .in('tipo', ['troncal', 'distribucion', 'derivacion'])
        .order('codigo');
      if (error) throw error;
      return data as { id: string; codigo: string; tipo: string; estado: string }[];
    },
  });
  const [napElegida, setNapElegida] = useState<NapTopologia | null>(null);
  const [analisis, setAnalisis] = useState<Analisis>(null);

  // NAP que dependen del elemento analizado (para resaltarlas en el árbol).
  const afectadas = useMemo(() => {
    if (!analisis || !topo.data) return new Set<string>();
    const todas = [...topo.data.olts.flatMap((o) => o.pons.flatMap((p) => p.naps)), ...topo.data.sin_ruta];
    return new Set(
      todas
        .filter((n) =>
          n.id === analisis.id ||
          n.pasos.some((p) =>
            (analisis.tipo === 'cable' && p.tipo === 'hilo' && p.cable_id === analisis.id) ||
            (analisis.tipo === 'pon' && p.tipo === 'pon' && p.id === analisis.id) ||
            (analisis.tipo === 'elemento' &&
              ((p.tipo === 'pon' && p.olt_id === analisis.id) ||
                ((p.tipo === 'empalme' || p.tipo === 'splitter') && p.elemento_id === analisis.id))),
          ),
        )
        .map((n) => n.id),
    );
  }, [analisis, topo.data]);

  if (topo.isPending) return <Cargando texto="Armando la topología…" />;
  if (topo.isError) return <Aviso tipo="error">{mensajeError(topo.error)}</Aviso>;
  const t: Topologia = topo.data;

  return (
    <>
      <EncabezadoPagina
        titulo="Topología de la red"
        detalle="Relaciones lógicas registradas: OLT → puerto PON → hilo del cable → NAP. No muestra el recorrido geográfico, que está en el mapa."
      />

      <section className="mb-8 grid gap-4 rounded-md border border-linea bg-superficie p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <h2 className="font-cond text-lg font-semibold">Análisis de impacto</h2>
          <p className="mb-3 text-sm text-tenue">Elija un cable, una OLT o un puerto PON para ver qué NAP y clientes dependen de él.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Selector
              id="imp-cable"
              etiqueta="Cable"
              vacio="Elegir cable…"
              value={analisis?.tipo === 'cable' ? analisis.id : ''}
              onChange={(e) => {
                const c = cables.data?.find((x) => x.id === e.target.value);
                setAnalisis(c ? { tipo: 'cable', id: c.id, nombre: c.codigo } : null);
              }}
              opciones={(cables.data ?? []).map((c) => ({ valor: c.id, texto: `${c.codigo} (${c.tipo}${c.estado === 'fuera_servicio' ? ', fuera de servicio' : ''})` }))}
            />
            <Selector
              id="imp-olt"
              etiqueta="OLT o puerto PON"
              vacio="Elegir…"
              value={analisis && analisis.tipo !== 'cable' ? `${analisis.tipo}:${analisis.id}` : ''}
              onChange={(e) => {
                const [tipo, id] = e.target.value.split(':') as ['elemento' | 'pon', string];
                if (!id) return setAnalisis(null);
                const o = t.olts.find((x) => x.id === id);
                const p = t.olts.flatMap((x) => x.pons.map((pp) => ({ ...pp, olt: x.codigo }))).find((x) => x.id === id);
                setAnalisis({ tipo, id, nombre: o ? o.codigo : `${p?.olt} ${p?.etiqueta ?? ''}` });
              }}
              opciones={t.olts.flatMap((o) => [
                { valor: `elemento:${o.id}`, texto: `${o.codigo} (OLT completa)` },
                ...o.pons.map((p) => ({ valor: `pon:${p.id}`, texto: `${o.codigo} · ${p.etiqueta ?? 'PON'}` })),
              ])}
            />
          </div>
        </div>
        <div className="min-w-0">
          {analisis ? (
            <ImpactoPanel tipo={analisis.tipo} id={analisis.id} nombre={analisis.nombre} />
          ) : napElegida ? (
            <div>
              <h2 className="mb-2 font-cond text-lg font-semibold">Ruta de {napElegida.codigo}</h2>
              <RutaCadena camino={{ completo: !napElegida.faltante, pasos: napElegida.pasos, faltante: napElegida.faltante ?? null }} />
            </div>
          ) : (
            <p className="text-tenue">Toque una NAP del árbol para ver su ruta.</p>
          )}
        </div>
      </section>

      {t.olts.length === 0 && t.sin_ruta.length === 0 && (
        <p className="text-tenue">Aún no hay OLT ni NAP registradas. Agréguelas desde el mapa.</p>
      )}

      <div className="flex flex-col gap-8">
        {t.olts.map((o) => (
          <section key={o.id} aria-label={`OLT ${o.codigo}`}>
            <h2 className="flex items-center gap-2 font-cond text-xl font-semibold">
              <span className="size-3 rounded-sm bg-f-violeta" aria-hidden />
              <Link to={`/mapa?elemento=${o.id}`} className="hover:underline">{o.codigo}</Link>
              {o.estado === 'fuera_servicio' && <span className="text-sm font-normal text-error">fuera de servicio</span>}
            </h2>
            <ul className="ml-1.5 mt-2 flex flex-col gap-3 border-l-2 border-linea pl-5">
              {o.pons.map((p) => (
                <li key={p.id}>
                  <p className="text-sm font-medium text-tenue">
                    {p.etiqueta ?? 'PON'} · {p.naps.length === 0 ? 'sin NAP' : `${p.naps.length} NAP`}
                  </p>
                  {p.naps.length > 0 && (
                    <ul className="mt-1.5 flex flex-wrap gap-2">
                      {p.naps.map((n) => (
                        <NodoNap key={n.id} nap={n} elegida={napElegida?.id === n.id} afectada={afectadas.has(n.id)}
                          alElegir={() => { setNapElegida(n); setAnalisis(null); }} />
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}

        {t.sin_ruta.length > 0 && (
          <section>
            <h2 className="flex items-center gap-2 font-cond text-xl font-semibold text-alerta">
              <TriangleAlert className="size-5" aria-hidden /> NAP sin ruta completa hasta una OLT
            </h2>
            <p className="mb-2 text-sm text-tenue">Registre su alimentación desde la ficha de la NAP en el mapa.</p>
            <ul className="flex flex-wrap gap-2">
              {t.sin_ruta.map((n) => (
                <NodoNap key={n.id} nap={n} elegida={napElegida?.id === n.id} afectada={afectadas.has(n.id)}
                  alElegir={() => { setNapElegida(n); setAnalisis(null); }} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

function NodoNap({ nap, elegida, afectada, alElegir }: { nap: NapTopologia; elegida: boolean; afectada: boolean; alElegir: () => void }) {
  const hilo = nap.pasos.find((p): p is Extract<PasoCamino, { tipo: 'hilo' }> => p.tipo === 'hilo');
  const sinVerificar = nap.pasos.some((p) => 'confirmada' in p && !p.confirmada);
  const conFalla = nap.pasos.some(caido);
  const pct = nap.capacidad ? Math.round((nap.ocupados / nap.capacidad) * 100) : 0;
  return (
    <li>
      <button
        type="button"
        onClick={alElegir}
        aria-pressed={elegida}
        className={`min-w-[9.5rem] rounded-md border-2 bg-superficie px-3 py-2 text-left
          ${afectada ? 'border-error bg-error/5' : conFalla ? 'border-error' : 'border-linea'}
          ${sinVerificar && !afectada ? 'border-dashed' : ''}
          ${elegida ? 'ring-2 ring-tinta ring-offset-1' : ''}`}
      >
        <span className="block font-medium">{nap.codigo}</span>
        {hilo && (
          <span className="flex items-center gap-1 text-xs text-tenue">
            <span className="size-2.5 rounded-full border border-linea" style={{ background: COLOR_HILO[hilo.color] ?? hilo.color }} aria-hidden />
            {hilo.cable_codigo} · h{hilo.numero}
          </span>
        )}
        <span className="cifra block text-xs text-tenue">{nap.ocupados}/{nap.capacidad} ocupados ({pct} %)</span>
        {nap.faltante && <span className="block text-xs text-alerta">{nap.faltante}</span>}
      </button>
    </li>
  );
}
