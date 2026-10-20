import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { Plus, Search } from 'lucide-react';
import { mensajeError } from '../lib/errores';
import { formatearFechaHora } from '../lib/formato';
import { Aviso, Cargando, EncabezadoPagina, Paginacion } from '../components/ui';
import { ESTADOS_ORDEN, TIPOS_ORDEN, listarOrdenes, nombreTipo, tecnicosActivos } from './api';
import { InsigniaOrden, InsigniaPrioridad } from './componentes';

const POR_PAGINA = 25;

export function ListaOrdenes() {
  const [params, setParams] = useSearchParams();
  const filtros = {
    texto: '',
    estado: params.get('estado') ?? 'abiertas',
    tipo: params.get('tipo') ?? '',
    tecnico: params.get('tecnico') ?? '',
  };
  const pagina = Number(params.get('p') ?? '0');
  const [texto, setTexto] = useState('');
  const [consultaTexto, setConsultaTexto] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setConsultaTexto(texto), 350);
    return () => window.clearTimeout(t);
  }, [texto]);

  const tecnicos = useQuery({ queryKey: ['ordenes', 'tecnicos'], queryFn: tecnicosActivos });
  const consulta = useQuery({
    queryKey: ['ordenes', 'lista', filtros, consultaTexto, pagina],
    queryFn: () => listarOrdenes({ ...filtros, texto: consultaTexto, estado: filtros.estado === 'todas' ? '' : filtros.estado }, pagina, POR_PAGINA),
    placeholderData: keepPreviousData,
  });

  function cambiar(k: string, v: string) {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== 'p') n.delete('p');
    setParams(n, { replace: true });
  }

  return (
    <>
      <EncabezadoPagina
        titulo="Órdenes de trabajo"
        acciones={
          <Link to="/ordenes/nueva" className="inline-flex items-center gap-2 rounded-md bg-acento px-4 py-2 text-[15px] font-semibold text-white hover:bg-acento-osc">
            <Plus className="size-4" aria-hidden /> Nueva orden
          </Link>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue" aria-hidden />
          <input type="search" aria-label="Buscar órdenes" placeholder="Número, contacto, dirección o técnico" value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="w-full rounded-md border border-linea bg-superficie py-2 pl-9 pr-3 outline-none focus:border-acento" />
        </div>
        <select aria-label="Estado" value={filtros.estado} onChange={(e) => cambiar('estado', e.target.value)} className="rounded-md border border-linea bg-superficie px-3 py-2">
          <option value="abiertas">Abiertas</option>
          <option value="todas">Todas</option>
          {ESTADOS_ORDEN.map((e) => <option key={e.valor} value={e.valor}>{e.nombre}</option>)}
        </select>
        <select aria-label="Tipo" value={filtros.tipo} onChange={(e) => cambiar('tipo', e.target.value)} className="rounded-md border border-linea bg-superficie px-3 py-2">
          <option value="">Todos los tipos</option>
          {TIPOS_ORDEN.map((t) => <option key={t.valor} value={t.valor}>{t.nombre}</option>)}
        </select>
        <select aria-label="Técnico" value={filtros.tecnico} onChange={(e) => cambiar('tecnico', e.target.value)} className="rounded-md border border-linea bg-superficie px-3 py-2">
          <option value="">Todos los técnicos</option>
          <option value="sin">Sin técnico</option>
          {tecnicos.data?.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </select>
      </div>

      {consulta.isPending && <Cargando />}
      {consulta.isError && <Aviso tipo="error">{mensajeError(consulta.error)}</Aviso>}
      {consulta.data && (consulta.data.filas.length === 0 ? (
        <p className="py-8 text-tenue">No hay órdenes con estos filtros.</p>
      ) : (
        <>
          <ul className={`flex flex-col divide-y divide-linea rounded-md border border-linea bg-superficie ${consulta.isPlaceholderData ? 'opacity-60' : ''}`}>
            {consulta.data.filas.map((o) => (
              <li key={o.id} className="grid gap-1 px-4 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.3fr)_8rem] md:items-center md:gap-4">
                <div>
                  <Link to={`/ordenes/${o.id}`} className="font-medium text-acento hover:underline">{nombreTipo(o.tipo)} · {o.contacto_nombre ?? 'Sin contacto'}</Link>
                  <p className="text-sm"><span className="cifra text-tenue">{o.numero}</span> · <InsigniaPrioridad prioridad={o.prioridad} /></p>
                </div>
                <p className="text-sm">{[o.direccion, o.comuna].filter(Boolean).join(', ')}</p>
                <p className="text-sm">
                  {o.tecnico_nombre ?? <span className="text-alerta">Sin técnico</span>}
                  <span className="block text-tenue">{o.fecha_programada ? formatearFechaHora(o.fecha_programada) : 'Sin fecha'}</span>
                </p>
                <InsigniaOrden estado={o.estado} />
              </li>
            ))}
          </ul>
          <Paginacion pagina={pagina} total={consulta.data.total} porPagina={POR_PAGINA} alCambiar={(p) => cambiar('p', String(p))} />
        </>
      ))}
    </>
  );
}
