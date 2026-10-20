// Símbolos de los elementos en el mapa: forma por clase, color por tipo,
// trazo por estado. Se dibujan como SVG dentro de un L.divIcon.
import L from 'leaflet';
import type { Clase, ElementoMapa, EstadoElemento } from './tipos';

const FORMAS: Record<Clase, (c: string) => string> = {
  // Servidor: rectángulo con ranuras
  olt: (c) =>
    `<rect x="3" y="5" width="18" height="14" rx="2" fill="${c}"/>` +
    `<path d="M7 10h10M7 14h10" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`,
  // Caja con puertos
  nap: (c) =>
    `<rect x="3" y="3" width="18" height="18" rx="4" fill="${c}"/>` +
    `<g fill="#fff"><circle cx="8.5" cy="9" r="1.6"/><circle cx="15.5" cy="9" r="1.6"/>` +
    `<circle cx="8.5" cy="15" r="1.6"/><circle cx="15.5" cy="15" r="1.6"/></g>`,
  poste: (c) => `<circle cx="12" cy="12" r="5.5" fill="${c}"/>`,
  camara: (c) => `<rect x="5" y="5" width="14" height="14" fill="#fff" stroke="${c}" stroke-width="3"/>`,
  caja_empalme: (c) => `<path d="M12 2.5 21.5 12 12 21.5 2.5 12Z" fill="${c}"/>`,
  splitter: (c) => `<path d="M12 3 21 20H3Z" fill="${c}"/>`,
  gabinete: (c) =>
    `<rect x="5" y="3" width="14" height="18" rx="1.5" fill="${c}"/><path d="M9 7h6" stroke="#fff" stroke-width="1.6"/>`,
  punto_ingreso: (c) => `<path d="M12 3 21 10v11H3V10Z" fill="${c}"/>`,
  otro: (c) => `<circle cx="12" cy="12" r="7" fill="${c}"/><circle cx="12" cy="12" r="2.5" fill="#fff"/>`,
};

const TAMANO: Record<Clase, number> = {
  olt: 30,
  nap: 26,
  poste: 16,
  camara: 18,
  caja_empalme: 22,
  splitter: 20,
  gabinete: 22,
  punto_ingreso: 22,
  otro: 18,
};

function colorEstado(color: string, estado: EstadoElemento): string {
  if (estado === 'retirado') return '#8c969d';
  return color;
}

/** Anillo de ocupación para NAP: verde < 50 %, ámbar < umbral, rojo desde el umbral. */
function anilloNap(el: ElementoMapa, umbral: number): string {
  if (!el.nap || el.nap.capacidad === 0) return '';
  const pct = ((el.nap.ocupados + el.nap.reservados) / el.nap.capacidad) * 100;
  const color = pct >= umbral ? '#d33a2c' : pct >= 50 ? '#c98a06' : '#2e9d4f';
  const largo = 2 * Math.PI * 13.5;
  const lleno = Math.min(pct, 100) / 100;
  return (
    `<circle cx="12" cy="12" r="13.5" fill="none" stroke="#fff" stroke-width="3.5"/>` +
    `<circle cx="12" cy="12" r="13.5" fill="none" stroke="${color}" stroke-width="2.5"` +
    ` stroke-dasharray="${(largo * lleno).toFixed(1)} ${largo.toFixed(1)}" transform="rotate(-90 12 12)"/>`
  );
}

export function iconoElemento(
  el: ElementoMapa,
  opciones: { etiqueta: boolean; seleccionado: boolean; umbralOcupacion: number },
): L.DivIcon {
  const tam = TAMANO[el.clase];
  const color = colorEstado(el.color, el.estado);
  const opacidad = el.estado === 'planificado' || el.estado === 'en_construccion' ? 0.55 : 1;
  const alerta =
    el.estado === 'fuera_servicio'
      ? `<circle cx="12" cy="12" r="11" fill="none" stroke="#d33a2c" stroke-width="2.4" stroke-dasharray="3 2"/>`
      : '';
  const seleccion = opciones.seleccionado
    ? `<circle cx="12" cy="12" r="15.5" fill="none" stroke="#17232c" stroke-width="1.8"/>`
    : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 32 32" width="${tam + 8}" height="${tam + 8}"` +
    ` style="overflow:visible;filter:drop-shadow(0 1px 1px rgba(0,0,0,.35))">` +
    `<g opacity="${opacidad}">${FORMAS[el.clase](color)}</g>${anilloNap(el, opciones.umbralOcupacion)}${alerta}${seleccion}</svg>`;
  const etiqueta = opciones.etiqueta
    ? `<span class="mapa-etiqueta">${escaparHtml(el.codigo)}</span>`
    : '';
  return L.divIcon({
    className: 'mapa-simbolo',
    html: `<div class="mapa-simbolo-interior">${svg}${etiqueta}</div>`,
    iconSize: [tam + 8, tam + 8],
    iconAnchor: [(tam + 8) / 2, (tam + 8) / 2],
  });
}

export function iconoGrupo(cantidad: number): L.DivIcon {
  const tam = cantidad < 10 ? 30 : cantidad < 100 ? 36 : cantidad < 1000 ? 44 : 52;
  return L.divIcon({
    className: 'mapa-grupo',
    html: `<div style="width:${tam}px;height:${tam}px">${cantidad.toLocaleString('es-CL')}</div>`,
    iconSize: [tam, tam],
    iconAnchor: [tam / 2, tam / 2],
  });
}

/** Marcador de un punto nuevo o de vértices durante el dibujo. */
export function iconoPunto(color = '#1f6fd1', tam = 14): L.DivIcon {
  return L.divIcon({
    className: 'mapa-punto',
    html: `<div style="width:${tam}px;height:${tam}px;background:${color}"></div>`,
    iconSize: [tam, tam],
    iconAnchor: [tam / 2, tam / 2],
  });
}

export function svgClase(clase: Clase, color: string, tam = 18): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${tam}" height="${tam}">${FORMAS[clase](color)}</svg>`;
}

function escaparHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
