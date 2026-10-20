import { Fragment, useEffect, useMemo, useRef } from 'react';
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import type { Catalogos } from './api';
import { iconoElemento, iconoGrupo, iconoPunto } from './simbolos';
import { estiloCable, type CableMapa, type Coordenada, type ElementoMapa, type RespuestaElementos, type Seleccion, type Vista, type ZonaMapa } from './tipos';
import { formatearDistancia, longitudM } from './geo';

const aLatLng = (c: Coordenada): [number, number] => [c[1], c[0]];
const deLatLng = (ll: L.LatLng): Coordenada => [ll.lng, ll.lat];

/** Lo que se está dibujando o editando sobre el mapa. */
export type Borrador =
  | { tipo: 'ninguno' }
  | { tipo: 'punto'; punto: Coordenada } // elemento nuevo o movido
  | { tipo: 'linea'; puntos: Coordenada[]; uso: 'cable' | 'medir' } // dibujo en curso
  | { tipo: 'trazado'; puntos: Coordenada[] }; // edición de vértices

type Props = {
  catalogos: Catalogos;
  satelite: boolean;
  elementos: RespuestaElementos | undefined;
  cables: CableMapa[];
  zonas: ZonaMapa[];
  seleccion: Seleccion;
  /** Elemento oculto mientras se mueve (se dibuja el borrador en su lugar). */
  ocultarElemento: string | null;
  borrador: Borrador;
  capturaClics: boolean;
  miUbicacion: { punto: Coordenada; precision: number } | null;
  anchoPanel: number;
  alListo: (mapa: L.Map) => void;
  alCambiarVista: (v: Vista) => void;
  alClicMapa: (c: Coordenada) => void;
  alClicElemento: (e: ElementoMapa) => void;
  alClicCable: (c: CableMapa) => void;
  alMoverPunto: (c: Coordenada) => void;
  alMoverVertice: (i: number, c: Coordenada) => void;
  alInsertarVertice: (despuesDe: number, c: Coordenada) => void;
  alQuitarVertice: (i: number) => void;
};

export function MapaLienzo(p: Props) {
  return (
    <MapContainer
      center={[p.catalogos.centro.lat, p.catalogos.centro.lng]}
      zoom={p.catalogos.centro.zoom}
      maxZoom={20}
      zoomControl={false}
      className="h-full w-full"
    >
      <ControlZoom />
      <TileLayer
        key={p.satelite ? 'satelite' : 'calles'}
        url={p.satelite ? p.catalogos.satelite.url : p.catalogos.teselas.url}
        attribution={p.satelite ? p.catalogos.satelite.atribucion : p.catalogos.teselas.atribucion}
        maxNativeZoom={p.satelite ? p.catalogos.satelite.zoom_maximo : p.catalogos.teselas.zoom_maximo}
        maxZoom={20}
      />
      <Eventos {...p} />

      {p.zonas.map((z) => (
        <Polygon
          key={z.id}
          positions={(z.geometria.coordinates[0] ?? []).map(aLatLng)}
          pathOptions={{ color: z.color, weight: 1.5, fillOpacity: 0.07, dashArray: '6 4' }}
          interactive={false}
        />
      ))}

      <CapaCables {...p} />
      <CapaElementos {...p} />
      <CapaBorrador {...p} />

      {p.miUbicacion && (
        <>
          <Circle
            center={aLatLng(p.miUbicacion.punto)}
            radius={p.miUbicacion.precision}
            pathOptions={{ color: '#1f6fd1', weight: 1, fillOpacity: 0.1 }}
            interactive={false}
          />
          <CircleMarker
            center={aLatLng(p.miUbicacion.punto)}
            radius={7}
            pathOptions={{ color: '#fff', weight: 3, fillColor: '#1f6fd1', fillOpacity: 1 }}
            interactive={false}
          />
        </>
      )}
    </MapContainer>
  );
}

function ControlZoom() {
  const mapa = useMap();
  useEffect(() => {
    // Control de zoom abajo a la derecha, lejos de los paneles superiores.
    const control = L.control.zoom({ position: 'bottomright', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' });
    control.addTo(mapa);
    return () => {
      control.remove();
    };
  }, [mapa]);
  return null;
}

function Eventos({ alListo, alCambiarVista, alClicMapa, capturaClics, anchoPanel }: Props) {
  const temporizador = useRef<number | undefined>(undefined);
  const mapa = useMapEvents({
    moveend: () => programar(),
    click: (e) => alClicMapa(deLatLng(e.latlng)),
  });

  function emitir() {
    const b = mapa.getBounds();
    alCambiarVista({ oeste: b.getWest(), sur: b.getSouth(), este: b.getEast(), norte: b.getNorth(), zoom: mapa.getZoom() });
  }
  function programar() {
    window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(emitir, 250);
  }

  useEffect(() => {
    alListo(mapa);
    emitir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapa]);

  // Mientras un clic agrega puntos: cursor de cruz y sin zoom por doble clic.
  useEffect(() => {
    mapa.getContainer().classList.toggle('mapa-cursor-cruz', capturaClics);
    if (capturaClics) mapa.doubleClickZoom.disable();
    else mapa.doubleClickZoom.enable();
  }, [mapa, capturaClics]);

  // El panel lateral cambia el ancho del mapa: Leaflet debe recalcular.
  useEffect(() => {
    const t = window.setTimeout(() => mapa.invalidateSize(), 50);
    return () => window.clearTimeout(t);
  }, [mapa, anchoPanel]);

  return null;
}

function CapaCables({ cables, seleccion, alClicCable, alClicMapa, capturaClics }: Props) {
  return (
    <>
      {cables.map((c) => {
        const posiciones = c.coordenadas.map(aLatLng);
        const seleccionado = seleccion?.tipo === 'cable' && seleccion.id === c.id;
        const estilo = estiloCable(c.tipo, c.estado);
        return (
          <Fragment key={c.id}>
            {seleccionado && (
              <Polyline
                positions={posiciones}
                pathOptions={{ color: '#17232c', weight: estilo.weight + 7, opacity: 0.35 }}
                interactive={false}
              />
            )}
            <Polyline positions={posiciones} pathOptions={estilo} interactive={false} />
            {/* Línea invisible más ancha para poder tocarla en pantallas táctiles */}
            <Polyline
              positions={posiciones}
              pathOptions={{ color: '#000', weight: 16, opacity: 0, bubblingMouseEvents: false }}
              eventHandlers={{
                // Si se está dibujando, tocar un cable agrega un punto en ese lugar.
                click: (ev: L.LeafletMouseEvent) =>
                  capturaClics ? alClicMapa(deLatLng(ev.latlng)) : alClicCable(c),
              }}
            >
              <Tooltip sticky>
                {c.codigo} · {c.tipo} · {c.hilos_usados}/{c.cantidad_fibras} hilos
              </Tooltip>
            </Polyline>
          </Fragment>
        );
      })}
    </>
  );
}

function CapaElementos({
  elementos,
  seleccion,
  ocultarElemento,
  alClicElemento,
  catalogos,
}: Props) {
  const mapa = useMap();
  const zoom = mapa.getZoom();
  const conEtiqueta = zoom >= 17;

  const marcadores = useMemo(() => {
    if (!elementos || elementos.modo !== 'elementos') return [];
    return elementos.items
      .filter((e) => e.id !== ocultarElemento)
      .map((e) => ({
        e,
        icono: iconoElemento(e, {
          etiqueta: conEtiqueta,
          seleccionado: seleccion?.tipo === 'elemento' && seleccion.id === e.id,
          umbralOcupacion: catalogos.umbralOcupacion,
        }),
      }));
  }, [elementos, seleccion, ocultarElemento, conEtiqueta, catalogos.umbralOcupacion]);

  if (!elementos) return null;

  if (elementos.modo === 'grupos') {
    return (
      <>
        {elementos.items.map((g, i) => (
          <Marker
            key={`${g.lng}-${g.lat}-${i}`}
            position={[g.lat, g.lng]}
            icon={iconoGrupo(g.cantidad)}
            eventHandlers={{ click: () => mapa.setView([g.lat, g.lng], Math.min(mapa.getZoom() + 2, 18)) }}
            title={`${g.cantidad} elementos (${g.nap} NAP). Toque para acercar.`}
          />
        ))}
      </>
    );
  }

  return (
    <>
      {marcadores.map(({ e, icono }) => (
        <Marker
          key={e.id}
          position={[e.lat, e.lng]}
          icon={icono}
          title={`${e.codigo} · ${e.tipo_nombre}`}
          eventHandlers={{ click: () => alClicElemento(e) }}
        />
      ))}
    </>
  );
}

function CapaBorrador({ borrador, alMoverPunto, alMoverVertice, alInsertarVertice, alQuitarVertice }: Props) {
  if (borrador.tipo === 'ninguno') return null;

  if (borrador.tipo === 'punto') {
    return (
      <Marker
        position={aLatLng(borrador.punto)}
        icon={iconoPunto('#e8740c', 20)}
        draggable
        autoPan
        eventHandlers={{ dragend: (ev) => alMoverPunto(deLatLng((ev.target as L.Marker).getLatLng())) }}
        title="Arrastre para ajustar la ubicación"
      />
    );
  }

  const posiciones = borrador.puntos.map(aLatLng);

  if (borrador.tipo === 'linea') {
    const ultimo = borrador.puntos[borrador.puntos.length - 1];
    return (
      <>
        <Polyline
          positions={posiciones}
          pathOptions={{ color: borrador.uso === 'medir' ? '#17232c' : '#e8740c', weight: 3, dashArray: '6 6' }}
          interactive={false}
        />
        {borrador.puntos.map((c, i) => (
          <Marker key={i} position={aLatLng(c)} icon={iconoPunto(borrador.uso === 'medir' ? '#17232c' : '#e8740c', 10)} interactive={false} />
        ))}
        {ultimo && borrador.puntos.length > 1 && (
          <CircleMarker center={aLatLng(ultimo)} radius={1} pathOptions={{ opacity: 0, fillOpacity: 0 }} interactive={false}>
            <Tooltip permanent direction="right" offset={[10, 0]} className="mapa-medida">
              {formatearDistancia(longitudM(borrador.puntos))}
            </Tooltip>
          </CircleMarker>
        )}
      </>
    );
  }

  // Edición de trazado: vértices arrastrables y puntos intermedios para agregar.
  return (
    <>
      <Polyline positions={posiciones} pathOptions={{ color: '#e8740c', weight: 4 }} interactive={false} />
      {borrador.puntos.slice(1).map((c, i) => {
        const a = borrador.puntos[i]!;
        const medio: Coordenada = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
        return (
          <Marker
            key={`m${i}`}
            position={aLatLng(medio)}
            icon={iconoPunto('#8c969d', 12)}
            title="Agregar un punto aquí"
            eventHandlers={{ click: () => alInsertarVertice(i, medio) }}
          />
        );
      })}
      {borrador.puntos.map((c, i) => (
        <Marker
          key={`v${i}-${c[0]}-${c[1]}`}
          position={aLatLng(c)}
          icon={iconoPunto(i === 0 || i === borrador.puntos.length - 1 ? '#17232c' : '#e8740c', 16)}
          draggable
          autoPan
          title={
            i === 0 || i === borrador.puntos.length - 1
              ? 'Extremo del cable (si tiene origen o destino, queda unido a ese elemento)'
              : 'Arrastre para mover; toque para quitar'
          }
          eventHandlers={{
            dragend: (ev) => alMoverVertice(i, deLatLng((ev.target as L.Marker).getLatLng())),
            click: () => {
              if (i !== 0 && i !== borrador.puntos.length - 1) alQuitarVertice(i);
            },
          }}
        />
      ))}
    </>
  );
}
