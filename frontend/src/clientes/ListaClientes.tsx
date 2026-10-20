import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { Download, Plus, Search } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { tieneRol } from '../lib/roles';
import { mensajeError } from '../lib/errores';
import { formatearRut } from '../lib/rut';
import { formatearClp, formatearFecha, formatearTelefono } from '../lib/formato';
import { aCsv, descargarCsv, fechaArchivo } from '../lib/csv';
import { Aviso, Boton, Cargando, EncabezadoPagina } from '../components/ui';
import {
  ESTADOS_CLIENTE,
  POR_PAGINA,
  cargarPlanesYComunas,
  listarClientes,
  todosLosClientes,
  type ClienteVista,
  type EstadoCliente,
  type FiltrosClientes,
} from './api';

export function InsigniaCliente({ estado }: { estado: EstadoCliente }) {
  const e = ESTADOS_CLIENTE.find((x) => x.valor === estado);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="size-2 rounded-full" style={{ background: e?.color }} aria-hidden />
      {e?.nombre ?? estado}
    </span>
  );
}

export function ListaClientes() {
  const { roles } = useAuth();
  const puedeCrear = tieneRol(roles, 'atencion_cliente');
  const [params, setParams] = useSearchParams();

  // Los filtros viven en la URL: se pueden compartir y el panel enlaza aquí.
  const filtros: FiltrosClientes = {
    texto: params.get('q') ?? '',
    estado: (params.get('estado') as EstadoCliente | null) ?? '',
    comunaId: params.get('comuna') ? Number(params.get('comuna')) : null,
    planId: params.get('plan') ? Number(params.get('plan')) : null,
    sinPuerto: params.get('sin_puerto') === '1',
  };
  const pagina = Number(params.get('p') ?? '0');
  const [texto, setTexto] = useState(filtros.texto);
  const [exportando, setExportando] = useState(false);
  const [errorExportar, setErrorExportar] = useState('');

  function cambiar(cambios: Record<string, string | null>) {
    const nuevos = new URLSearchParams(params);
    for (const [k, v] of Object.entries(cambios)) {
      if (v == null || v === '') nuevos.delete(k);
      else nuevos.set(k, v);
    }
    if (!('p' in cambios)) nuevos.delete('p');
    setParams(nuevos, { replace: true });
  }

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (texto !== filtros.texto) cambiar({ q: texto });
    }, 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  const catalogos = useQuery({ queryKey: ['clientes', 'catalogos'], queryFn: cargarPlanesYComunas, staleTime: 5 * 60_000 });
  const consulta = useQuery({
    queryKey: ['clientes', 'lista', filtros, pagina],
    queryFn: () => listarClientes(filtros, pagina),
    placeholderData: keepPreviousData,
  });

  const total = consulta.data?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  async function exportar() {
    setExportando(true);
    setErrorExportar('');
    try {
      const filas = await todosLosClientes(filtros);
      descargarCsv(
        `clientes-${fechaArchivo()}.csv`,
        aCsv<ClienteVista>(filas, [
          { titulo: 'Código', valor: (c) => c.codigo },
          { titulo: 'Nombre', valor: (c) => c.nombre },
          { titulo: 'RUT', valor: (c) => formatearRut(c.rut) },
          { titulo: 'Teléfono', valor: (c) => c.telefono },
          { titulo: 'WhatsApp', valor: (c) => c.whatsapp },
          { titulo: 'Correo', valor: (c) => c.email },
          { titulo: 'Dirección', valor: (c) => [c.direccion_calle, c.direccion_numero, c.direccion_depto].filter(Boolean).join(' ') },
          { titulo: 'Comuna', valor: (c) => c.comuna },
          { titulo: 'Plan', valor: (c) => c.plan },
          { titulo: 'Precio mensual (CLP)', valor: (c) => c.precio_efectivo_clp },
          { titulo: 'Estado', valor: (c) => c.estado },
          { titulo: 'NAP', valor: (c) => c.nap_codigo },
          { titulo: 'Puerto', valor: (c) => c.puerto },
          { titulo: 'Contrato', valor: (c) => c.numero_contrato },
          { titulo: 'Fecha de contratación', valor: (c) => (c.fecha_contratacion ? formatearFecha(c.fecha_contratacion) : '') },
          { titulo: 'N.º de serie ONT', valor: (c) => c.numero_serie_ont },
        ]),
      );
    } catch (e) {
      setErrorExportar(mensajeError(e));
    } finally {
      setExportando(false);
    }
  }

  return (
    <>
      <EncabezadoPagina
        titulo="Clientes"
        detalle={consulta.data ? `${total.toLocaleString('es-CL')} cliente${total === 1 ? '' : 's'} con los filtros actuales.` : undefined}
        acciones={
          <div className="flex gap-2">
            <Boton variante="secundario" onClick={() => void exportar()} cargando={exportando} disabled={total === 0}>
              {!exportando && <Download className="size-4" aria-hidden />} Exportar CSV
            </Boton>
            {puedeCrear && (
              <Link
                to="/clientes/nuevo"
                className="inline-flex items-center gap-2 rounded-md bg-acento px-4 py-2 text-[15px] font-semibold text-white hover:bg-acento-osc"
              >
                <Plus className="size-4" aria-hidden /> Nuevo cliente
              </Link>
            )}
          </div>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue" aria-hidden />
          <input
            type="search"
            aria-label="Buscar clientes"
            placeholder="Nombre, RUT, código, dirección o teléfono"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="w-full rounded-md border border-linea bg-superficie py-2 pl-9 pr-3 outline-none focus:border-acento"
          />
        </div>
        <select
          aria-label="Estado"
          value={filtros.estado}
          onChange={(e) => cambiar({ estado: e.target.value })}
          className="rounded-md border border-linea bg-superficie px-3 py-2"
        >
          <option value="">Todos los estados</option>
          {ESTADOS_CLIENTE.map((e) => (
            <option key={e.valor} value={e.valor}>{e.nombre}</option>
          ))}
        </select>
        <select
          aria-label="Comuna"
          value={filtros.comunaId ?? ''}
          onChange={(e) => cambiar({ comuna: e.target.value })}
          className="rounded-md border border-linea bg-superficie px-3 py-2"
        >
          <option value="">Todas las comunas</option>
          {catalogos.data?.comunas.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
        <select
          aria-label="Plan"
          value={filtros.planId ?? ''}
          onChange={(e) => cambiar({ plan: e.target.value })}
          className="rounded-md border border-linea bg-superficie px-3 py-2"
        >
          <option value="">Todos los planes</option>
          {catalogos.data?.planes.map((p) => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 whitespace-nowrap px-1">
          <input
            type="checkbox"
            className="size-4 accent-[var(--color-acento)]"
            checked={filtros.sinPuerto}
            onChange={(e) => cambiar({ sin_puerto: e.target.checked ? '1' : null })}
          />
          Sin puerto
        </label>
      </div>

      {errorExportar && <div className="mb-4"><Aviso tipo="error">{errorExportar}</Aviso></div>}
      {consulta.isPending && <Cargando />}
      {consulta.isError && <Aviso tipo="error">{mensajeError(consulta.error)}</Aviso>}

      {consulta.data && (
        consulta.data.filas.length === 0 ? (
          <p className="py-8 text-tenue">
            No hay clientes con estos filtros.{puedeCrear && ' Use «Nuevo cliente» para registrar el primero.'}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border border-linea bg-superficie">
              <table className={`w-full min-w-[860px] text-left ${consulta.isPlaceholderData ? 'opacity-60' : ''}`}>
                <thead className="border-b border-linea text-sm text-tenue">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Cliente</th>
                    <th scope="col" className="px-3 py-3 font-medium">Dirección</th>
                    <th scope="col" className="px-3 py-3 font-medium">Plan</th>
                    <th scope="col" className="px-3 py-3 font-medium">NAP</th>
                    <th scope="col" className="px-3 py-3 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {consulta.data.filas.map((c) => (
                    <tr key={c.id} className="border-b border-linea last:border-0 hover:bg-fondo/60">
                      <td className="px-4 py-3">
                        <Link to={`/clientes/${c.id}`} className="font-medium text-acento hover:underline">{c.nombre}</Link>
                        <p className="text-sm text-tenue">
                          <span className="cifra">{c.codigo}</span> · {formatearRut(c.rut)}
                          {c.telefono && <> · {formatearTelefono(c.telefono)}</>}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        {[c.direccion_calle, c.direccion_numero, c.direccion_depto].filter(Boolean).join(' ')}
                        <p className="text-sm text-tenue">{c.comuna}</p>
                      </td>
                      <td className="px-3 py-3">
                        {c.plan ?? '—'}
                        <p className="cifra text-sm text-tenue">{formatearClp(c.precio_efectivo_clp)}</p>
                      </td>
                      <td className="px-3 py-3">
                        {c.nap_codigo ? (
                          <span className="cifra">{c.nap_codigo} #{c.puerto}</span>
                        ) : (
                          <span className="text-tenue">Sin puerto</span>
                        )}
                      </td>
                      <td className="px-3 py-3"><InsigniaCliente estado={c.estado} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="mt-4 flex items-center justify-between" aria-label="Paginación">
              <p className="text-sm text-tenue">
                Página {pagina + 1} de {paginas}
              </p>
              <div className="flex gap-2">
                <Boton variante="secundario" disabled={pagina === 0} onClick={() => cambiar({ p: String(pagina - 1) })}>
                  Anterior
                </Boton>
                <Boton variante="secundario" disabled={pagina + 1 >= paginas} onClick={() => cambiar({ p: String(pagina + 1) })}>
                  Siguiente
                </Boton>
              </div>
            </nav>
          </>
        )
      )}
    </>
  );
}
