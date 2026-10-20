import { useEffect } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Marker as MarcadorLeaflet } from 'leaflet';
import { iconoPunto } from '../mapa/simbolos';

type Punto = { lng: number; lat: number };

/**
 * Mapa pequeño para ubicar o mostrar un punto (por ejemplo, la casa del
 * cliente). Si recibe alCambiar, un toque en el mapa o arrastrar el punto
 * cambia la ubicación.
 */
export function MiniMapa({
  valor,
  centro,
  alCambiar,
  extras = [],
  linea,
  alto = 260,
}: {
  valor: Punto | null;
  centro: { lat: number; lng: number; zoom: number };
  alCambiar?: (p: Punto) => void;
  extras?: { punto: Punto; texto: string; color: string }[];
  linea?: [Punto, Punto];
  alto?: number;
}) {
  return (
    <div className="isolate overflow-hidden rounded-md border border-linea" style={{ height: alto }}>
      <MapContainer
        center={valor ? [valor.lat, valor.lng] : [centro.lat, centro.lng]}
        zoom={valor ? 17 : centro.zoom}
        className="h-full w-full"
        scrollWheelZoom={false}
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; colaboradores de OpenStreetMap"
          maxNativeZoom={19}
          maxZoom={20}
        />
        {alCambiar && <Clics alCambiar={alCambiar} />}
        <Recentrar valor={valor} />
        {linea && (
          <Polyline
            positions={linea.map((p) => [p.lat, p.lng] as [number, number])}
            pathOptions={{ color: '#7b4cc2', weight: 2, dashArray: '4 4' }}
          />
        )}
        {extras.map((e, i) => (
          <CircleMarker
            key={i}
            center={[e.punto.lat, e.punto.lng]}
            radius={7}
            pathOptions={{ color: '#fff', weight: 2, fillColor: e.color, fillOpacity: 1 }}
          >
            <Tooltip direction="top" offset={[0, -6]}>{e.texto}</Tooltip>
          </CircleMarker>
        ))}
        {valor && (
          <Marker
            position={[valor.lat, valor.lng]}
            icon={iconoPunto('#e8740c', 18)}
            draggable={!!alCambiar}
            eventHandlers={
              alCambiar
                ? { dragend: (ev) => {
                    const ll = (ev.target as MarcadorLeaflet).getLatLng();
                    alCambiar({ lng: ll.lng, lat: ll.lat });
                  } }
                : {}
            }
          />
        )}
      </MapContainer>
    </div>
  );
}

function Clics({ alCambiar }: { alCambiar: (p: Punto) => void }) {
  useMapEvents({ click: (e) => alCambiar({ lng: e.latlng.lng, lat: e.latlng.lat }) });
  return null;
}

/** Si el punto cambia desde fuera (por ejemplo, "usar mi ubicación"), centra el mapa. */
function Recentrar({ valor }: { valor: Punto | null }) {
  const mapa = useMap();
  useEffect(() => {
    if (valor && !mapa.getBounds().contains([valor.lat, valor.lng])) {
      mapa.setView([valor.lat, valor.lng], Math.max(mapa.getZoom(), 17));
    }
  }, [mapa, valor]);
  return null;
}
