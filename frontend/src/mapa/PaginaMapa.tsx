import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, LocateFixed, Plus, Ruler, Satellite, Spline, X } from 'lucide-react';
import type L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAuth } from '../auth/AuthProvider';
import { tieneRol } from '../lib/roles';
import { mensajeError } from '../lib/errores';
import { Aviso, Boton, Cargando } from '../components/ui';
import {
  actualizarCable,
  cargarCables,
  cargarCatalogos,
  cargarElementos,
  cargarZonas,
  eliminarCable,
  eliminarElemento,
  moverElemento,
} from './api';
import { MapaLienzo, type Borrador } from './MapaLienzo';
import { PanelCapas } from './PanelCapas';
import { Buscador } from './Buscador';
import { FichaElementoPanel } from './FichaElementoPanel';
import { FichaCablePanel } from './FichaCablePanel';
import { FormElemento } from './FormElemento';
import { FormCable, type Candidato } from './FormCable';
import { formatearDistancia, longitudM, masCercanos } from './geo';
import { svgClase } from './simbolos';
import {
  CLASES,
  ESTADOS,
  TIPOS_CABLE,
  type Clase,
  type Coordenada,
  type ElementoMapa,
  type FichaCable,
  type FichaElemento,
  type Filtros,
  type ResultadoBusqueda,
  type Seleccion,
  type Vista,
} from './tipos';

type Modo =
  | { tipo: 'normal' }
  | { tipo: 'elegir-ubicacion'; clase: Clase; tipoCodigo: string }
  | { tipo: 'form-elemento'; clase: Clase; tipoCodigo: string; punto: Coordenada; ficha?: FichaElemento }
  | { tipo: 'mover'; ficha: FichaElemento; punto: Coordenada }
  | { tipo: 'dibujar'; puntos: Coordenada[] }
  | { tipo: 'form-cable'; puntos: Coordenada[]; ficha?: FichaCable }
  | { tipo: 'trazado'; ficha: FichaCable; puntos: Coordenada[] }
  | { tipo: 'medir'; puntos: Coordenada[] };

const FILTROS_INICIALES: Filtros = {
  clases: CLASES.map((c) => c.valor),
  tiposCable: TIPOS_CABLE.map((t) => t.valor),
  estados: ESTADOS.filter((e) => e.valor !== 'retirado').map((e) => e.valor),
  sector: '',
  zonas: true,
};

const RADIO_CANDIDATOS_M = 200;

export function PaginaMapa() {
  const { roles } = useAuth();
  const puedeEditar = tieneRol(roles, 'supervisor_red');
  const qc = useQueryClient();

  const catalogos = useQuery({ queryKey: ['mapa', 'catalogos'], queryFn: cargarCatalogos, staleTime: 10 * 60_000 });

  const [mapa, setMapa] = useState<L.Map | null>(null);
  const [vista, setVista] = useState<Vista | null>(null);
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INICIALES);
  const [sectorConsulta, setSectorConsulta] = useState('');
  const [satelite, setSatelite] = useState(false);
  const [verCapas, setVerCapas] = useState(false);
  const [menuAgregar, setMenuAgregar] = useState(false);
  const [seleccion, setSeleccion] = useState<Seleccion>(null);
  const [modo, setModo] = useState<Modo>({ tipo: 'normal' });
  const [miUbicacion, setMiUbicacion] = useState<{ punto: Coordenada; precision: number } | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'error' | 'exito'; texto: string } | null>(null);

  // El sector se escribe libremente; se consulta medio segundo después.
  useEffect(() => {
    const t = window.setTimeout(() => setSectorConsulta(filtros.sector), 500);
    return () => window.clearTimeout(t);
  }, [filtros.sector]);
  const filtrosConsulta = useMemo(() => ({ ...filtros, sector: sectorConsulta }), [filtros, sectorConsulta]);

  const claveVista = vista
    ? [vista.oeste, vista.sur, vista.este, vista.norte].map((n) => n.toFixed(5)).join(',') + `@${Math.round(vista.zoom)}`
    : '';

  const elementos = useQuery({
    queryKey: ['mapa', 'elementos', claveVista, filtrosConsulta],
    queryFn: () => cargarElementos(vista!, filtrosConsulta),
    enabled: vista != null,
    placeholderData: keepPreviousData,
  });
  const cables = useQuery({
    queryKey: ['mapa', 'cables', claveVista, filtrosConsulta.tiposCable, filtrosConsulta.estados],
    queryFn: () => cargarCables(vista!, filtrosConsulta),
    enabled: vista != null,
    placeholderData: keepPreviousData,
  });
  const zonas = useQuery({
    queryKey: ['mapa', 'zonas', claveVista],
    queryFn: () => cargarZonas(vista!),
    enabled: vista != null && filtros.zonas,
    placeholderData: keepPreviousData,
  });

  const itemsElementos: ElementoMapa[] =
    elementos.data?.modo === 'elementos' ? elementos.data.items : [];

  // Escape cancela la herramienta en curso.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setModo({ tipo: 'normal' });
        setMenuAgregar(false);
      }
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, []);

  async function refrescar() {
    await qc.invalidateQueries({ queryKey: ['mapa'] });
  }

  // ---------------- Acciones sobre el mapa ----------------

  /** Si el punto cae cerca de un elemento cargado, se usa su posición exacta. */
  function ajustar(c: Coordenada): Coordenada {
    const radio = catalogos.data?.ajusteMetros ?? 30;
    const cercano = masCercanos(c, itemsElementos, radio, 1)[0];
    return cercano ? [cercano.lng, cercano.lat] : c;
  }

  function alClicMapa(c: Coordenada) {
    setMenuAgregar(false);
    switch (modo.tipo) {
      case 'elegir-ubicacion':
        setModo({ tipo: 'form-elemento', clase: modo.clase, tipoCodigo: modo.tipoCodigo, punto: c });
        break;
      case 'dibujar':
        setModo({ tipo: 'dibujar', puntos: [...modo.puntos, ajustar(c)] });
        break;
      case 'medir':
        setModo({ tipo: 'medir', puntos: [...modo.puntos, c] });
        break;
      case 'form-elemento':
        // Mientras se crea un elemento, un toque en el mapa cambia su ubicación.
        if (!modo.ficha) setModo({ ...modo, punto: c });
        break;
      case 'normal':
        setSeleccion(null);
        break;
      default:
        break;
    }
  }

  function alClicElemento(e: ElementoMapa) {
    const c: Coordenada = [e.lng, e.lat];
    if (modo.tipo === 'dibujar') setModo({ tipo: 'dibujar', puntos: [...modo.puntos, c] });
    else if (modo.tipo === 'medir') setModo({ tipo: 'medir', puntos: [...modo.puntos, c] });
    else if (modo.tipo === 'normal') setSeleccion({ tipo: 'elemento', id: e.id });
  }

  function irA(lng: number, lat: number, zoom = 18) {
    mapa?.flyTo([lat, lng], Math.max(zoom, mapa.getZoom()), { duration: 0.6 });
  }

  function alElegirBusqueda(r: ResultadoBusqueda) {
    setModo({ tipo: 'normal' });
    if (r.lng != null && r.lat != null) irA(r.lng, r.lat);
    if (r.tipo === 'elemento') setSeleccion({ tipo: 'elemento', id: r.id });
    else if (r.tipo === 'cable') setSeleccion({ tipo: 'cable', id: r.id });
    else {
      setSeleccion(null);
      setAviso({
        tipo: 'exito',
        texto: r.lng != null ? `Ubicación de ${r.titulo}.` : `${r.titulo} no tiene ubicación registrada.`,
      });
    }
  }

  function ubicarme() {
    if (!mapa) return;
    setAviso(null);
    mapa.once('locationfound', (e: L.LocationEvent) => {
      setMiUbicacion({ punto: [e.latlng.lng, e.latlng.lat], precision: e.accuracy });
    });
    mapa.once('locationerror', () =>
      setAviso({ tipo: 'error', texto: 'No se pudo obtener su ubicación. Revise el permiso de ubicación del navegador.' }),
    );
    mapa.locate({ setView: true, maxZoom: 18, enableHighAccuracy: true });
  }

  // ---------------- Mutaciones ----------------

  const borrarElemento = useMutation({
    mutationFn: (f: FichaElemento) => eliminarElemento(f.id),
    onSuccess: async (_d, f) => {
      setSeleccion(null);
      setAviso({ tipo: 'exito', texto: `${f.codigo} eliminado.` });
      await refrescar();
    },
    onError: (e) => setAviso({ tipo: 'error', texto: mensajeError(e) }),
  });

  const borrarCable = useMutation({
    mutationFn: (f: FichaCable) => eliminarCable(f.id),
    onSuccess: async (_d, f) => {
      setSeleccion(null);
      setAviso({ tipo: 'exito', texto: `Cable ${f.codigo} eliminado.` });
      await refrescar();
    },
    onError: (e) => setAviso({ tipo: 'error', texto: mensajeError(e) }),
  });

  const guardarPosicion = useMutation({
    mutationFn: (m: { id: string; punto: Coordenada }) => moverElemento(m.id, m.punto[0], m.punto[1]),
    onSuccess: async () => {
      setModo({ tipo: 'normal' });
      await refrescar();
    },
  });

  const guardarTrazado = useMutation({
    mutationFn: (m: { id: string; puntos: Coordenada[] }) => actualizarCable(m.id, { coordenadas: m.puntos }),
    onSuccess: async () => {
      setModo({ tipo: 'normal' });
      await refrescar();
    },
  });

  // ---------------- Derivados para el lienzo ----------------

  const borrador: Borrador =
    modo.tipo === 'form-elemento' && !modo.ficha ? { tipo: 'punto', punto: modo.punto }
    : modo.tipo === 'mover' ? { tipo: 'punto', punto: modo.punto }
    : modo.tipo === 'dibujar' ? { tipo: 'linea', puntos: modo.puntos, uso: 'cable' }
    : modo.tipo === 'medir' ? { tipo: 'linea', puntos: modo.puntos, uso: 'medir' }
    : modo.tipo === 'trazado' ? { tipo: 'trazado', puntos: modo.puntos }
    : { tipo: 'ninguno' };

  const capturaClics = modo.tipo === 'elegir-ubicacion' || modo.tipo === 'dibujar' || modo.tipo === 'medir';

  function candidatos(punto: Coordenada | undefined): Candidato[] {
    if (!punto) return [];
    return masCercanos(punto, itemsElementos, RADIO_CANDIDATOS_M, 8).map((e) => ({
      id: e.id,
      codigo: e.codigo,
      tipo_nombre: e.tipo_nombre,
      distancia: e.distancia,
    }));
  }

  // ---------------- Panel lateral ----------------

  let panel: ReactNode = null;
  if (catalogos.data) {
    if (modo.tipo === 'form-elemento') {
      panel = (
        <FormElemento
          key={modo.ficha?.id ?? 'nuevo'}
          catalogos={catalogos.data}
          clase={modo.clase}
          tipoCodigo={modo.tipoCodigo}
          punto={modo.punto}
          ficha={modo.ficha}
          alCambiarPunto={(punto) => setModo({ ...modo, punto })}
          alGuardar={async (id) => {
            setModo({ tipo: 'normal' });
            setSeleccion({ tipo: 'elemento', id });
            await refrescar();
          }}
          alCancelar={() => setModo({ tipo: 'normal' })}
        />
      );
    } else if (modo.tipo === 'form-cable') {
      panel = (
        <FormCable
          key={modo.ficha?.id ?? 'nuevo'}
          catalogos={catalogos.data}
          puntos={modo.puntos}
          ficha={modo.ficha}
          candidatosOrigen={candidatos(modo.puntos[0])}
          candidatosDestino={candidatos(modo.puntos[modo.puntos.length - 1])}
          alGuardar={async (id) => {
            setModo({ tipo: 'normal' });
            setSeleccion({ tipo: 'cable', id });
            await refrescar();
          }}
          alCancelar={() => setModo({ tipo: 'normal' })}
        />
      );
    } else if (modo.tipo === 'mover') {
      panel = (
        <div className="flex flex-col gap-3">
          <h2 className="font-cond text-2xl font-semibold">Mover {modo.ficha.codigo}</h2>
          <p className="text-tenue">
            Arrastre el punto naranjo hasta la nueva ubicación. Los cables que nacen o terminan en este elemento lo
            seguirán.
          </p>
          <p className="cifra text-sm">
            {modo.punto[1].toFixed(6)}, {modo.punto[0].toFixed(6)}
          </p>
          {guardarPosicion.isError && <Aviso tipo="error">{mensajeError(guardarPosicion.error)}</Aviso>}
          <div className="flex gap-3">
            <Boton
              cargando={guardarPosicion.isPending}
              onClick={() => guardarPosicion.mutate({ id: modo.ficha.id, punto: modo.punto })}
            >
              Guardar ubicación
            </Boton>
            <Boton variante="secundario" onClick={() => setModo({ tipo: 'normal' })}>
              Cancelar
            </Boton>
          </div>
        </div>
      );
    } else if (modo.tipo === 'trazado') {
      panel = (
        <div className="flex flex-col gap-3">
          <h2 className="font-cond text-2xl font-semibold">Trazado de {modo.ficha.codigo}</h2>
          <ul className="list-disc pl-5 text-tenue">
            <li>Arrastre los puntos naranjos para mover el recorrido.</li>
            <li>Toque un punto gris para agregar un vértice en ese tramo.</li>
            <li>Toque un punto naranjo para quitarlo.</li>
            <li>Los extremos con origen o destino quedan unidos a su elemento.</li>
          </ul>
          <p className="text-sm">
            Largo: <span className="cifra font-semibold">{formatearDistancia(longitudM(modo.puntos))}</span>
          </p>
          {guardarTrazado.isError && <Aviso tipo="error">{mensajeError(guardarTrazado.error)}</Aviso>}
          <div className="flex gap-3">
            <Boton
              cargando={guardarTrazado.isPending}
              onClick={() => guardarTrazado.mutate({ id: modo.ficha.id, puntos: modo.puntos })}
            >
              Guardar trazado
            </Boton>
            <Boton variante="secundario" onClick={() => setModo({ tipo: 'normal' })}>
              Cancelar
            </Boton>
          </div>
        </div>
      );
    } else if (modo.tipo === 'normal' && seleccion?.tipo === 'elemento') {
      panel = (
        <FichaElementoPanel
          id={seleccion.id}
          puedeEditar={puedeEditar}
          eliminando={borrarElemento.isPending}
          alEditar={(f) =>
            setModo({ tipo: 'form-elemento', clase: f.clase, tipoCodigo: f.tipo_codigo, punto: [f.lng, f.lat], ficha: f })
          }
          alMover={(f) => setModo({ tipo: 'mover', ficha: f, punto: [f.lng, f.lat] })}
          alEliminar={(f) => {
            if (window.confirm(`¿Eliminar ${f.codigo}? Quedará registrado en la auditoría.`)) borrarElemento.mutate(f);
          }}
          alVerCable={(id) => setSeleccion({ tipo: 'cable', id })}
        />
      );
    } else if (modo.tipo === 'normal' && seleccion?.tipo === 'cable') {
      panel = (
        <FichaCablePanel
          id={seleccion.id}
          puedeEditar={puedeEditar}
          eliminando={borrarCable.isPending}
          alEditarDatos={(f) => setModo({ tipo: 'form-cable', puntos: f.coordenadas, ficha: f })}
          alEditarTrazado={(f) => setModo({ tipo: 'trazado', ficha: f, puntos: f.coordenadas })}
          alEliminar={(f) => {
            if (window.confirm(`¿Eliminar el cable ${f.codigo}? Quedará registrado en la auditoría.`)) borrarCable.mutate(f);
          }}
          alVerElemento={(id) => setSeleccion({ tipo: 'elemento', id })}
        />
      );
    }
  }

  const cerrarPanel = () => {
    setSeleccion(null);
    setModo({ tipo: 'normal' });
  };

  if (catalogos.isPending) return <div className="p-6"><Cargando texto="Cargando mapa…" /></div>;
  if (catalogos.isError) return <div className="p-6"><Aviso tipo="error">{mensajeError(catalogos.error)}</Aviso></div>;
  const cat = catalogos.data;

  return (
    <div className="relative isolate flex h-full overflow-hidden">
      <div className="relative min-w-0 flex-1">
        <MapaLienzo
          catalogos={cat}
          satelite={satelite}
          elementos={elementos.data}
          cables={cables.data ?? []}
          zonas={filtros.zonas ? (zonas.data ?? []) : []}
          seleccion={seleccion}
          ocultarElemento={modo.tipo === 'mover' ? modo.ficha.id : null}
          borrador={borrador}
          capturaClics={capturaClics}
          miUbicacion={miUbicacion}
          anchoPanel={panel ? 1 : 0}
          alListo={setMapa}
          alCambiarVista={setVista}
          alClicMapa={alClicMapa}
          alClicElemento={alClicElemento}
          alClicCable={(c) => modo.tipo === 'normal' && setSeleccion({ tipo: 'cable', id: c.id })}
          alMoverPunto={(punto) => {
            if (modo.tipo === 'form-elemento' || modo.tipo === 'mover') setModo({ ...modo, punto });
          }}
          alMoverVertice={(i, c) => {
            if (modo.tipo === 'trazado') setModo({ ...modo, puntos: modo.puntos.map((p, j) => (j === i ? c : p)) });
          }}
          alInsertarVertice={(i, c) => {
            if (modo.tipo === 'trazado')
              setModo({ ...modo, puntos: [...modo.puntos.slice(0, i + 1), c, ...modo.puntos.slice(i + 1)] });
          }}
          alQuitarVertice={(i) => {
            if (modo.tipo === 'trazado' && modo.puntos.length > 2)
              setModo({ ...modo, puntos: modo.puntos.filter((_, j) => j !== i) });
          }}
        />

        {/* Búsqueda y estado de carga */}
        <div className="pointer-events-none absolute inset-x-3 top-3 z-[1000] flex flex-col gap-2 sm:right-auto sm:w-[380px]">
          <div className="pointer-events-auto">
            <Buscador alElegir={alElegirBusqueda} />
          </div>
          {(elementos.isFetching || cables.isFetching) && (
            <p className="w-fit rounded bg-superficie/95 px-2 py-1 text-sm text-tenue shadow">Cargando la zona…</p>
          )}
          {elementos.data?.modo === 'grupos' && (
            <p className="pointer-events-auto w-fit rounded bg-superficie/95 px-2 py-1 text-sm shadow">
              {elementos.data.total.toLocaleString('es-CL')} elementos agrupados. Acerque el mapa para verlos uno a uno.
            </p>
          )}
          {(elementos.isError || cables.isError) && (
            <div className="pointer-events-auto">
              <Aviso tipo="error">{mensajeError(elementos.error ?? cables.error)}</Aviso>
            </div>
          )}
          {aviso && (
            <div className="pointer-events-auto flex items-start gap-2">
              <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>
              <button type="button" aria-label="Cerrar aviso" className="mt-1.5 text-tenue" onClick={() => setAviso(null)}>
                <X className="size-4" aria-hidden />
              </button>
            </div>
          )}
        </div>

        {/* Herramientas */}
        <div className="absolute right-3 top-16 z-[1000] flex flex-col items-end gap-2 sm:top-3">
          <BarraBoton etiqueta="Capas y filtros" activo={verCapas} onClick={() => setVerCapas((v) => !v)}>
            <Layers className="size-5" aria-hidden />
          </BarraBoton>
          <BarraBoton etiqueta={satelite ? 'Ver calles' : 'Ver satélite'} activo={satelite} onClick={() => setSatelite((s) => !s)}>
            <Satellite className="size-5" aria-hidden />
          </BarraBoton>
          <BarraBoton etiqueta="Mi ubicación" onClick={ubicarme}>
            <LocateFixed className="size-5" aria-hidden />
          </BarraBoton>
          <BarraBoton
            etiqueta="Medir distancia"
            activo={modo.tipo === 'medir'}
            onClick={() => {
              setSeleccion(null);
              setModo(modo.tipo === 'medir' ? { tipo: 'normal' } : { tipo: 'medir', puntos: [] });
            }}
          >
            <Ruler className="size-5" aria-hidden />
          </BarraBoton>
          {puedeEditar && (
            <>
              <div className="relative">
                <BarraBoton
                  etiqueta="Agregar elemento"
                  activo={menuAgregar || modo.tipo === 'elegir-ubicacion'}
                  onClick={() => setMenuAgregar((m) => !m)}
                >
                  <Plus className="size-5" aria-hidden />
                </BarraBoton>
                {menuAgregar && (
                  <ul className="absolute right-full top-0 mr-2 w-56 rounded-md border border-linea bg-superficie py-1 shadow-lg">
                    {cat.tipos.map((t) => (
                      <li key={t.codigo}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-fondo"
                          onClick={() => {
                            setMenuAgregar(false);
                            setSeleccion(null);
                            setModo({ tipo: 'elegir-ubicacion', clase: t.clase, tipoCodigo: t.codigo });
                          }}
                        >
                          <span aria-hidden dangerouslySetInnerHTML={{ __html: svgClase(t.clase, t.color) }} />
                          {t.nombre}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <BarraBoton
                etiqueta="Dibujar cable"
                activo={modo.tipo === 'dibujar'}
                onClick={() => {
                  setSeleccion(null);
                  setModo(modo.tipo === 'dibujar' ? { tipo: 'normal' } : { tipo: 'dibujar', puntos: [] });
                }}
              >
                <Spline className="size-5" aria-hidden />
              </BarraBoton>
            </>
          )}
        </div>

        {/* Capas y filtros */}
        {verCapas && (
          <div className="absolute bottom-3 left-3 top-16 z-[1000] w-72 max-w-[calc(100%-1.5rem)] overflow-auto rounded-md border border-linea bg-superficie p-4 shadow-lg sm:top-16">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-cond text-xl font-semibold">Capas</h2>
              <button type="button" aria-label="Cerrar capas" onClick={() => setVerCapas(false)} className="rounded p-1 text-tenue hover:bg-fondo">
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <PanelCapas filtros={filtros} catalogos={cat} alCambiar={setFiltros} />
          </div>
        )}

        {/* Instrucciones de la herramienta activa */}
        {(modo.tipo === 'elegir-ubicacion' || modo.tipo === 'dibujar' || modo.tipo === 'medir') && (
          <div className="absolute inset-x-3 bottom-6 z-[1000] mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3 rounded-md bg-chaqueta px-4 py-3 text-white shadow-lg">
            <p className="min-w-0 flex-1">
              {modo.tipo === 'elegir-ubicacion' && 'Toque el mapa donde está el elemento.'}
              {modo.tipo === 'dibujar' &&
                (modo.puntos.length === 0
                  ? 'Toque el inicio del cable. Si toca un elemento, el cable queda unido a él.'
                  : `${modo.puntos.length} punto${modo.puntos.length > 1 ? 's' : ''} · ${formatearDistancia(longitudM(modo.puntos))}. Siga tocando el recorrido.`)}
              {modo.tipo === 'medir' &&
                (modo.puntos.length < 2
                  ? 'Toque dos o más puntos para medir.'
                  : `Distancia: ${formatearDistancia(longitudM(modo.puntos))}`)}
              {modo.tipo === 'dibujar' && elementos.data?.modo === 'grupos' && (
                <span className="block text-sm text-white/70">Acerque el mapa para poder unir el cable a los elementos.</span>
              )}
            </p>
            <div className="flex gap-2">
              {(modo.tipo === 'dibujar' || modo.tipo === 'medir') && modo.puntos.length > 0 && (
                <button
                  type="button"
                  className="rounded-md border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10"
                  onClick={() => setModo({ ...modo, puntos: modo.puntos.slice(0, -1) })}
                >
                  Deshacer punto
                </button>
              )}
              {modo.tipo === 'dibujar' && (
                <button
                  type="button"
                  disabled={modo.puntos.length < 2}
                  className="rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-tinta disabled:opacity-50"
                  onClick={() => setModo({ tipo: 'form-cable', puntos: modo.puntos })}
                >
                  Terminar
                </button>
              )}
              <button
                type="button"
                className="rounded-md border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10"
                onClick={() => setModo({ tipo: 'normal' })}
              >
                {modo.tipo === 'medir' ? 'Cerrar' : 'Cancelar'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Panel lateral (escritorio) u hoja inferior (móvil) */}
      {panel && (
        <aside
          className="absolute inset-x-0 bottom-0 z-[1100] max-h-[65%] overflow-auto rounded-t-xl border-t border-linea bg-superficie p-5 shadow-2xl
                     lg:static lg:z-auto lg:max-h-none lg:w-[400px] lg:shrink-0 lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-none"
          aria-label="Detalle"
        >
          {(modo.tipo === 'normal') && (
            <button
              type="button"
              onClick={cerrarPanel}
              aria-label="Cerrar detalle"
              className="float-right -mr-1 -mt-1 rounded p-1 text-tenue hover:bg-fondo"
            >
              <X className="size-5" aria-hidden />
            </button>
          )}
          {panel}
        </aside>
      )}
    </div>
  );
}

function BarraBoton({
  etiqueta,
  activo = false,
  onClick,
  children,
}: {
  etiqueta: string;
  activo?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={etiqueta}
      aria-label={etiqueta}
      aria-pressed={activo}
      onClick={onClick}
      className={`grid size-11 place-items-center rounded-md border shadow-sm transition-colors
        ${activo ? 'border-chaqueta bg-chaqueta text-white' : 'border-linea bg-superficie text-tinta hover:border-tenue'}`}
    >
      {children}
    </button>
  );
}
