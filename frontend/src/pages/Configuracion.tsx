import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { mensajeError } from '../lib/errores';
import { formatearClp } from '../lib/formato';
import { Aviso, Boton, Campo, Cargando, EncabezadoPagina } from '../components/ui';

type Plan = { id: number; nombre: string; bajada_mbps: number; subida_mbps: number; precio_clp: number; descripcion: string | null; activo: boolean };
type Parametro = { clave: string; valor: unknown; descripcion: string };

// Parámetros editables aquí (los de mapa con estructura se editan en la base).
const EDITABLES: { clave: string; tipo: 'texto' | 'numero'; unidad?: string }[] = [
  { clave: 'nombre_empresa', tipo: 'texto' },
  { clave: 'distancia_max_acometida_m', tipo: 'numero', unidad: 'm' },
  { clave: 'presupuesto_optico_db', tipo: 'numero', unidad: 'dB' },
  { clave: 'perdida_conector_db', tipo: 'numero', unidad: 'dB' },
  { clave: 'perdida_empalme_db', tipo: 'numero', unidad: 'dB' },
  { clave: 'potencia_min_dbm', tipo: 'numero', unidad: 'dBm' },
  { clave: 'potencia_max_dbm', tipo: 'numero', unidad: 'dBm' },
  { clave: 'reserva_puerto_horas', tipo: 'numero', unidad: 'h' },
  { clave: 'ocupacion_alerta_pct', tipo: 'numero', unidad: '%' },
  { clave: 'mapa_ajuste_metros', tipo: 'numero', unidad: 'm' },
];

export function Configuracion() {
  return (
    <>
      <EncabezadoPagina titulo="Configuración" detalle="Planes comerciales y parámetros técnicos de la empresa." />
      <div className="grid gap-12 xl:grid-cols-2">
        <Planes />
        <Parametros />
      </div>
    </>
  );
}

function Planes() {
  const qc = useQueryClient();
  const planes = useQuery({
    queryKey: ['configuracion', 'planes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('planes').select('*').order('activo', { ascending: false }).order('precio_clp');
      if (error) throw error;
      return data as Plan[];
    },
  });
  const [editando, setEditando] = useState<Plan | 'nuevo' | null>(null);

  const alternar = useMutation({
    mutationFn: async (p: Plan) => {
      const { error } = await supabase.from('planes').update({ activo: !p.activo }).eq('id', p.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configuracion', 'planes'] }),
  });

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-cond text-xl font-semibold">Planes</h2>
        {!editando && <Boton className="px-3 py-1.5 text-sm" onClick={() => setEditando('nuevo')}>Nuevo plan</Boton>}
      </div>
      {editando && (
        <FormPlan plan={editando === 'nuevo' ? null : editando} alCerrar={() => setEditando(null)} />
      )}
      {planes.isPending && <Cargando />}
      {planes.isError && <Aviso tipo="error">{mensajeError(planes.error)}</Aviso>}
      {alternar.isError && <Aviso tipo="error">{mensajeError(alternar.error)}</Aviso>}
      {planes.data && planes.data.length === 0 && (
        <p className="text-tenue">Aún no hay planes. Cree al menos uno para poder activar clientes.</p>
      )}
      <ul className="flex flex-col">
        {planes.data?.map((p) => (
          <li key={p.id} className={`flex items-center justify-between gap-3 border-t border-linea py-3 ${p.activo ? '' : 'text-tenue'}`}>
            <div>
              <p className="font-medium">{p.nombre}{!p.activo && ' (inactivo)'}</p>
              <p className="cifra text-sm text-tenue">
                {p.bajada_mbps}/{p.subida_mbps} Mbps · {formatearClp(p.precio_clp)} al mes
              </p>
            </div>
            <div className="flex gap-2">
              <Boton variante="secundario" className="px-3 py-1.5 text-sm" onClick={() => setEditando(p)}>Editar</Boton>
              <Boton variante="texto" className="text-sm" onClick={() => alternar.mutate(p)}>
                {p.activo ? 'Desactivar' : 'Activar'}
              </Boton>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-tenue">Un plan inactivo no se ofrece a clientes nuevos, pero los actuales lo conservan.</p>
    </section>
  );
}

function FormPlan({ plan, alCerrar }: { plan: Plan | null; alCerrar: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState({
    nombre: plan?.nombre ?? '',
    bajada: plan ? String(plan.bajada_mbps) : '',
    subida: plan ? String(plan.subida_mbps) : '',
    precio: plan ? String(plan.precio_clp) : '',
    descripcion: plan?.descripcion ?? '',
  });
  const guardar = useMutation({
    mutationFn: async () => {
      const fila = {
        nombre: d.nombre.trim(),
        bajada_mbps: Number(d.bajada),
        subida_mbps: Number(d.subida),
        precio_clp: Math.round(Number(d.precio)),
        descripcion: d.descripcion.trim() || null,
      };
      const { error } = plan
        ? await supabase.from('planes').update(fila).eq('id', plan.id)
        : await supabase.from('planes').insert(fila);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['configuracion', 'planes'] });
      await qc.invalidateQueries({ queryKey: ['clientes', 'catalogos'] });
      alCerrar();
    },
  });
  const valido = d.nombre.trim().length >= 2 && Number(d.bajada) > 0 && Number(d.subida) > 0 && d.precio !== '' && Number(d.precio) >= 0;
  function enviar(e: FormEvent) {
    e.preventDefault();
    if (valido) guardar.mutate();
  }
  return (
    <form onSubmit={enviar} className="mb-5 grid grid-cols-2 gap-3 rounded-md border border-linea bg-superficie p-4">
      <div className="col-span-2"><Campo id="pl-nombre" etiqueta="Nombre" value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} /></div>
      <Campo id="pl-bajada" etiqueta="Bajada (Mbps)" type="number" min={1} value={d.bajada} onChange={(e) => setD({ ...d, bajada: e.target.value })} />
      <Campo id="pl-subida" etiqueta="Subida (Mbps)" type="number" min={1} value={d.subida} onChange={(e) => setD({ ...d, subida: e.target.value })} />
      <Campo id="pl-precio" etiqueta="Precio mensual (CLP)" type="number" min={0} step={1} value={d.precio} onChange={(e) => setD({ ...d, precio: e.target.value })} />
      <Campo id="pl-desc" etiqueta="Descripción" value={d.descripcion} onChange={(e) => setD({ ...d, descripcion: e.target.value })} />
      {guardar.isError && <div className="col-span-2"><Aviso tipo="error">{mensajeError(guardar.error)}</Aviso></div>}
      <div className="col-span-2 flex gap-3">
        <Boton type="submit" cargando={guardar.isPending} disabled={!valido}>{plan ? 'Guardar plan' : 'Crear plan'}</Boton>
        <Boton type="button" variante="secundario" onClick={alCerrar}>Cancelar</Boton>
      </div>
    </form>
  );
}

function Parametros() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['configuracion', 'parametros'],
    queryFn: async () => {
      const { data, error } = await supabase.from('configuracion').select('clave, valor, descripcion').in('clave', EDITABLES.map((e) => e.clave));
      if (error) throw error;
      return data as Parametro[];
    },
  });
  const [valores, setValores] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState<{ tipo: 'error' | 'exito'; texto: string } | null>(null);

  const guardar = useMutation({
    mutationFn: async () => {
      for (const [clave, texto] of Object.entries(valores)) {
        const def = EDITABLES.find((e) => e.clave === clave)!;
        const valor = def.tipo === 'numero' ? Number(texto.replace(',', '.')) : texto.trim();
        if (def.tipo === 'numero' && !Number.isFinite(valor)) throw new Error(`Valor no numérico en ${clave}`);
        const { error } = await supabase.from('configuracion').update({ valor }).eq('clave', clave);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      setValores({});
      setAviso({ tipo: 'exito', texto: 'Parámetros guardados.' });
      await qc.invalidateQueries();
    },
    onError: (e) => setAviso({ tipo: 'error', texto: mensajeError(e) }),
  });

  if (q.isPending) return <Cargando />;
  if (q.isError) return <Aviso tipo="error">{mensajeError(q.error)}</Aviso>;
  const porClave = new Map(q.data.map((p) => [p.clave, p]));

  return (
    <section>
      <h2 className="mb-3 font-cond text-xl font-semibold">Parámetros</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setAviso(null);
          guardar.mutate();
        }}
        className="flex flex-col gap-3"
      >
        {EDITABLES.filter((e) => porClave.has(e.clave)).map((e) => {
          const p = porClave.get(e.clave)!;
          const actual = valores[e.clave] ?? String(p.valor ?? '');
          return (
            <Campo
              key={e.clave}
              id={`par-${e.clave}`}
              etiqueta={e.unidad ? `${p.descripcion} (${e.unidad})` : p.descripcion}
              type={e.tipo === 'numero' ? 'number' : 'text'}
              step="any"
              value={actual}
              onChange={(ev) => setValores({ ...valores, [e.clave]: ev.target.value })}
            />
          );
        })}
        {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
        <Boton type="submit" cargando={guardar.isPending} disabled={Object.keys(valores).length === 0} className="self-start">
          Guardar parámetros
        </Boton>
      </form>
    </section>
  );
}
