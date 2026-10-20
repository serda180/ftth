import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { Plus, Search } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { tieneRol } from '../lib/roles';
import { mensajeError } from '../lib/errores';
import { formatearFecha } from '../lib/formato';
import { Aviso, Cargando, EncabezadoPagina, Insignia, Paginacion } from '../components/ui';
import { ESTADOS_SOLICITUD, listarSolicitudes } from './api';

const POR_PAGINA = 25;

export function ListaSolicitudes() {
  const { roles } = useAuth();
  const puedeCrear = tieneRol(roles, 'atencion_cliente', 'supervisor_red');
  const [params, setParams] = useSearchParams();
  const estado = params.get('estado') ?? 'abiertas';
  const pagina = Number(params.get('p') ?? '0');
  const [texto, setTexto] = useState(params.get('q') ?? '');
  const [consultaTexto, setConsultaTexto] = useState(texto);

  useEffect(() => {
    const t = window.setTimeout(() => setConsultaTexto(texto), 350);
    return () => window.clearTimeout(t);
  }, [texto]);

  const consulta = useQuery({
    queryKey: ['solicitudes', 'lista', estado, consultaTexto, pagina],
    queryFn: () => listarSolicitudes({ texto: consultaTexto, estado: estado === 'todas' ? '' : estado }, pagina, POR_PAGINA),
    placeholderData: keepPreviousData,
  });

  function cambiar(k: string, v: string | null) {
    const n = new URLSearchParams(params);
    if (v == null || v === '') n.delete(k);
    else n.set(k, v);
    if (k !== 'p') n.delete('p');
    setParams(n, { replace: true });
  }

  return (
    <>
      <EncabezadoPagina
        titulo="Solicitudes de instalación"
        detalle="Desde el primer contacto hasta la activación del servicio."
        acciones={
          puedeCrear && (
            <Link to="/solicitudes/nueva" className="inline-flex items-center gap-2 rounded-md bg-acento px-4 py-2 text-[15px] font-semibold text-white hover:bg-acento-osc">
              <Plus className="size-4" aria-hidden /> Nueva solicitud
            </Link>
          )
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue" aria-hidden />
          <input type="search" aria-label="Buscar solicitudes" placeholder="Número, nombre, RUT, dirección o teléfono"
            value={texto} onChange={(e) => setTexto(e.target.value)}
            className="w-full rounded-md border border-linea bg-superficie py-2 pl-9 pr-3 outline-none focus:border-acento" />
        </div>
        <select aria-label="Estado" value={estado} onChange={(e) => cambiar('estado', e.target.value)}
          className="rounded-md border border-linea bg-superficie px-3 py-2">
          <option value="abiertas">En curso</option>
          <option value="todas">Todas</option>
          {ESTADOS_SOLICITUD.map((e) => <option key={e.valor} value={e.valor}>{e.nombre}</option>)}
        </select>
      </div>

      {consulta.isPending && <Cargando />}
      {consulta.isError && <Aviso tipo="error">{mensajeError(consulta.error)}</Aviso>}
      {consulta.data && (consulta.data.filas.length === 0 ? (
        <p className="py-8 text-tenue">No hay solicitudes con estos filtros.</p>
      ) : (
        <>
          <ul className={`flex flex-col divide-y divide-linea rounded-md border border-linea bg-superficie ${consulta.isPlaceholderData ? 'opacity-60' : ''}`}>
            {consulta.data.filas.map((s) => {
              const e = ESTADOS_SOLICITUD.find((x) => x.valor === s.estado);
              return (
                <li key={s.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_10rem_7rem] sm:items-center sm:gap-4">
                  <div>
                    <Link to={`/solicitudes/${s.id}`} className="font-medium text-acento hover:underline">{s.nombre}</Link>
                    <p className="cifra text-sm text-tenue">{s.numero}</p>
                  </div>
                  <p className="text-sm">
                    {[s.direccion_calle, s.direccion_numero].filter(Boolean).join(' ')}
                    <span className="text-tenue">{s.comuna && `, ${s.comuna}`}</span>
                  </p>
                  <Insignia color={e?.color ?? '#999'}>{e?.nombre ?? s.estado}</Insignia>
                  <p className="text-sm text-tenue">{formatearFecha(s.creado_en)}</p>
                </li>
              );
            })}
          </ul>
          <Paginacion pagina={pagina} total={consulta.data.total} porPagina={POR_PAGINA} alCambiar={(p) => cambiar('p', String(p))} />
        </>
      ))}
    </>
  );
}
