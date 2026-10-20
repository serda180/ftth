import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { TriangleAlert } from 'lucide-react';
import type { Camino, PasoCamino } from './api';
import { COLOR_HILO } from '../mapa/tipos';

/**
 * Muestra la ruta registrada desde la OLT hasta el cliente (o la NAP), en el
 * orden en que viaja la señal. Las conexiones no verificadas en terreno se
 * dibujan con línea punteada; los tramos fuera de servicio, en rojo.
 */
export function RutaCadena({ camino, cliente }: { camino: Camino; cliente?: string }) {
  const pasos = [...camino.pasos].reverse(); // OLT → ... → NAP → puerto
  return (
    <div>
      {!camino.completo && (
        <p className="mb-3 flex items-start gap-2 text-sm text-alerta">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {camino.faltante}
        </p>
      )}
      <ol className="relative flex flex-col">
        {pasos.map((p, i) => (
          <Paso key={`${p.tipo}-${i}`} paso={p} ultimo={i === pasos.length - 1 && !cliente} />
        ))}
        {cliente && (
          <li className="relative flex gap-3 pb-1">
            <Nodo color="var(--color-f-violeta)" />
            <div>
              <p className="font-medium">{cliente}</p>
              <p className="text-sm text-tenue">Cliente (acometida)</p>
            </div>
          </li>
        )}
      </ol>
      <p className="mt-2 text-xs text-tenue">
        Línea continua: conexión verificada en terreno. Punteada: solo registrada. Esta es la topología lógica
        registrada, no el recorrido físico del cable.
      </p>
    </div>
  );
}

function Nodo({ color }: { color: string }) {
  return <span className="relative z-10 mt-1 size-3.5 shrink-0 rounded-full border-2 border-superficie" style={{ background: color }} aria-hidden />;
}

function Paso({ paso, ultimo }: { paso: PasoCamino; ultimo: boolean }) {
  const confirmada = 'confirmada' in paso ? paso.confirmada : true;
  const caido =
    (paso.tipo === 'nap' && paso.estado === 'fuera_servicio') ||
    (paso.tipo === 'hilo' && (paso.cable_estado === 'fuera_servicio' || paso.estado === 'danado')) ||
    (paso.tipo === 'pon' && paso.olt_estado === 'fuera_servicio') ||
    (paso.tipo === 'splitter' && paso.estado === 'fuera_servicio');

  let titulo: ReactNode = null;
  let detalle = '';
  let color = 'var(--color-f-gris)';
  switch (paso.tipo) {
    case 'pon':
      titulo = <Link to={`/mapa?elemento=${paso.olt_id}`} className="text-acento hover:underline">{paso.olt_codigo}</Link>;
      detalle = `OLT · ${paso.etiqueta ?? 'puerto PON'}`;
      color = 'var(--color-f-violeta)';
      break;
    case 'hilo':
      titulo = (
        <span className="inline-flex items-center gap-1.5">
          <Link to={`/mapa?cable=${paso.cable_id}`} className="text-acento hover:underline">{paso.cable_codigo}</Link>
          <span className="size-3 rounded-full border border-linea" style={{ background: COLOR_HILO[paso.color] ?? paso.color }} aria-hidden />
          <span className="text-tenue">hilo {paso.numero}</span>
        </span>
      );
      detalle = `Cable · ${paso.color}${paso.estado === 'danado' ? ' · hilo dañado' : ''}`;
      color = COLOR_HILO[paso.color] ?? color;
      break;
    case 'empalme':
      titulo = paso.codigo ?? 'Empalme';
      detalle = 'Empalme de hilos';
      break;
    case 'splitter':
      titulo = paso.codigo;
      detalle = 'Splitter';
      color = 'var(--color-f-rosado)';
      break;
    case 'nap':
      titulo = <Link to={`/mapa?elemento=${paso.id}`} className="text-acento hover:underline">{paso.codigo}</Link>;
      detalle = 'NAP';
      color = 'var(--color-f-aqua)';
      break;
    case 'puerto':
      titulo = `Puerto ${paso.numero}`;
      detalle = 'Puerto de la NAP';
      color = 'var(--color-f-azul)';
      break;
  }

  return (
    <li className="relative flex gap-3 pb-4">
      {!ultimo && (
        <span
          className="absolute left-[6px] top-4 h-full w-0 border-l-2"
          style={{ borderStyle: confirmada ? 'solid' : 'dashed', borderColor: caido ? 'var(--color-error)' : 'var(--color-linea)' }}
          aria-hidden
        />
      )}
      <Nodo color={caido ? 'var(--color-error)' : color} />
      <div className="min-w-0">
        <p className="font-medium">{titulo}</p>
        <p className="text-sm text-tenue">
          {detalle}
          {caido && <span className="text-error"> · fuera de servicio</span>}
          {!confirmada && ' · sin verificar'}
        </p>
      </div>
    </li>
  );
}
