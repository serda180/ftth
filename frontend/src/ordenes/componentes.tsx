// Piezas compartidas entre la ficha de orden (oficina) y la app del técnico.
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, MapPin, MessageCircle, Navigation, Phone } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { comprimirImagen } from '../lib/imagen';
import { mensajeError } from '../lib/errores';
import { formatearFechaHora, formatearTelefono } from '../lib/formato';
import { AreaTexto, Aviso, Boton, Campo, Cargando, Insignia } from '../components/ui';
import {
  ESTADOS_ORDEN,
  PRIORIDADES,
  cerrarOrden,
  fotosDeOrden,
  materialesDeOrden,
  miStock,
  rangoPotencia,
  registrarConsumo,
  subirFoto,
  type Foto,
  type OrdenVista,
} from './api';

export function InsigniaOrden({ estado }: { estado: OrdenVista['estado'] }) {
  const e = ESTADOS_ORDEN.find((x) => x.valor === estado);
  return <Insignia color={e?.color ?? '#999'}>{e?.nombre ?? estado}</Insignia>;
}

export function InsigniaPrioridad({ prioridad }: { prioridad: OrdenVista['prioridad'] }) {
  const p = PRIORIDADES.find((x) => x.valor === prioridad);
  return <span className="font-semibold" style={{ color: p?.color }}>{p?.nombre}</span>;
}

/** Botones grandes para llegar y contactar (pensados para el teléfono). */
export function AccionesContacto({ o }: { o: OrdenVista }) {
  const clase = 'inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md border border-linea bg-superficie px-3 text-[15px] font-semibold hover:border-tenue';
  return (
    <div className="flex flex-wrap gap-2">
      {o.lat != null && o.lng != null && (
        <>
          <a className={clase} href={`https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}`} target="_blank" rel="noreferrer">
            <Navigation className="size-5" aria-hidden /> Google Maps
          </a>
          <a className={clase} href={`https://waze.com/ul?ll=${o.lat},${o.lng}&navigate=yes`} target="_blank" rel="noreferrer">
            <MapPin className="size-5" aria-hidden /> Waze
          </a>
        </>
      )}
      {o.contacto_telefono && (
        <a className={clase} href={`tel:${o.contacto_telefono}`}>
          <Phone className="size-5" aria-hidden /> Llamar
        </a>
      )}
      {o.contacto_whatsapp && (
        <a className={clase} href={`https://wa.me/${o.contacto_whatsapp.replace('+', '')}`} target="_blank" rel="noreferrer">
          <MessageCircle className="size-5" aria-hidden /> WhatsApp
        </a>
      )}
    </div>
  );
}

export function ResumenContacto({ o }: { o: OrdenVista }) {
  return (
    <div>
      <p className="text-lg font-medium">{o.contacto_nombre ?? 'Sin contacto'}</p>
      <p className="text-tenue">{[o.direccion, o.comuna].filter(Boolean).join(', ')}</p>
      {o.contacto_telefono && <p className="cifra text-sm text-tenue">{formatearTelefono(o.contacto_telefono)}</p>}
      {(o.nap_codigo || o.plan) && (
        <p className="mt-1 text-sm">
          {o.nap_codigo && <>NAP <span className="cifra font-semibold">{o.nap_codigo}</span>, puerto <span className="cifra font-semibold">{o.puerto}</span></>}
          {o.plan && <span className="text-tenue"> · {o.plan}</span>}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Fotos
// ---------------------------------------------------------------------
export function FotosOrden({ ordenId, puedeSubir }: { ordenId: string; puedeSubir: boolean }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const [momento, setMomento] = useState<Foto['momento']>('antes');
  const fotos = useQuery({ queryKey: ['ordenes', 'fotos', ordenId], queryFn: () => fotosDeOrden(ordenId) });
  const subir = useMutation({
    mutationFn: async (archivos: File[]) => {
      for (const a of archivos) {
        const comprimida = await comprimirImagen(a);
        await subirFoto(ordenId, comprimida, momento, session!.user.id);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ordenes', 'fotos', ordenId] }),
  });

  return (
    <section>
      <h2 className="mb-2 font-cond text-xl font-semibold">Fotos</h2>
      {puedeSubir && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex rounded-md border border-linea" role="radiogroup" aria-label="Momento de la foto">
            {(['antes', 'despues', 'otro'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={momento === m} onClick={() => setMomento(m)}
                className={`px-3 py-2 text-sm first:rounded-l-md last:rounded-r-md ${momento === m ? 'bg-chaqueta text-white' : ''}`}>
                {{ antes: 'Antes', despues: 'Después', otro: 'Otra' }[m]}
              </button>
            ))}
          </div>
          <input ref={entrada} type="file" accept="image/*" capture="environment" multiple className="hidden"
            onChange={(e) => {
              const archivos = Array.from(e.target.files ?? []);
              if (archivos.length) subir.mutate(archivos);
              e.target.value = '';
            }} />
          <Boton className="min-h-12" cargando={subir.isPending} onClick={() => entrada.current?.click()}>
            {!subir.isPending && <Camera className="size-5" aria-hidden />} {subir.isPending ? 'Subiendo…' : 'Tomar o elegir foto'}
          </Boton>
        </div>
      )}
      {subir.isError && <div className="mb-2"><Aviso tipo="error">{mensajeError(subir.error)}</Aviso></div>}
      {fotos.isPending && <Cargando />}
      {fotos.data?.length === 0 && <p className="text-tenue">Sin fotos.</p>}
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {fotos.data?.map((f) => (
          <li key={f.id} className="relative overflow-hidden rounded-md bg-fondo">
            {f.url ? (
              <a href={f.url} target="_blank" rel="noreferrer">
                <img src={f.url} alt={`Foto ${f.momento}`} className="aspect-square w-full object-cover" loading="lazy" />
              </a>
            ) : (
              <div className="grid aspect-square place-items-center text-sm text-tenue">Sin vista previa</div>
            )}
            <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-xs text-white">
              {{ antes: 'Antes', despues: 'Después', otro: 'Otra' }[f.momento]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------
// Materiales
// ---------------------------------------------------------------------
export function MaterialesOrden({ ordenId, puedeRegistrar }: { ordenId: string; puedeRegistrar: boolean }) {
  const qc = useQueryClient();
  const usados = useQuery({ queryKey: ['ordenes', 'materiales', ordenId], queryFn: () => materialesDeOrden(ordenId) });
  const stock = useQuery({ queryKey: ['inventario', 'mi-stock'], queryFn: miStock, enabled: puedeRegistrar });
  const [articulo, setArticulo] = useState('');
  const [cantidad, setCantidad] = useState('1');
  const [equipo, setEquipo] = useState('');
  const elegido = stock.data?.items.find((i) => String(i.articulo_id) === articulo);
  const serializado = elegido?.articulos?.es_serializado ?? false;

  const registrar = useMutation({
    mutationFn: () =>
      registrarConsumo(ordenId, stock.data!.bodegaId!, Number(articulo), serializado ? 1 : Number(cantidad.replace(',', '.')), serializado ? equipo : null),
    onSuccess: async () => {
      setArticulo('');
      setCantidad('1');
      setEquipo('');
      await qc.invalidateQueries({ queryKey: ['ordenes', 'materiales', ordenId] });
      await qc.invalidateQueries({ queryKey: ['inventario'] });
    },
  });

  const valido = elegido && (serializado ? !!equipo : Number(cantidad.replace(',', '.')) > 0 && Number(cantidad.replace(',', '.')) <= elegido.cantidad);

  return (
    <section>
      <h2 className="mb-2 font-cond text-xl font-semibold">Materiales usados</h2>
      {usados.data?.length === 0 && <p className="text-tenue">Sin materiales registrados.</p>}
      <ul className="mb-3 flex flex-col gap-1">
        {usados.data?.map((m) => (
          <li key={m.id} className="flex justify-between gap-3 border-b border-linea py-1.5">
            <span>{m.articulos?.nombre}{m.equipos && <span className="text-tenue"> · S/N {m.equipos.numero_serie}</span>}</span>
            <span className="cifra">{Number(m.cantidad).toLocaleString('es-CL')} {m.articulos?.unidad === 'metro' ? 'm' : 'u'}</span>
          </li>
        ))}
      </ul>
      {puedeRegistrar && (
        stock.data?.bodegaId == null ? (
          <p className="text-sm text-tenue">{stock.isPending ? 'Cargando su stock…' : 'No tiene bodega asignada; pida a inventario que le asigne materiales.'}</p>
        ) : stock.data.items.length === 0 ? (
          <p className="text-sm text-tenue">Su bodega no tiene materiales disponibles.</p>
        ) : (
          <div className="flex flex-col gap-3 rounded-md border border-linea p-3">
            <label htmlFor="mat-art" className="text-sm font-medium">Material de su bodega</label>
            <select id="mat-art" value={articulo} onChange={(e) => { setArticulo(e.target.value); setEquipo(''); }}
              className="min-h-12 rounded-md border border-linea bg-superficie px-3">
              <option value="">Elegir…</option>
              {stock.data.items.map((i) => (
                <option key={i.articulo_id} value={i.articulo_id}>
                  {i.articulos?.nombre} (quedan {Number(i.cantidad).toLocaleString('es-CL')} {i.articulos?.unidad === 'metro' ? 'm' : 'u'})
                </option>
              ))}
            </select>
            {elegido && (serializado ? (
              <>
                <label htmlFor="mat-eq" className="text-sm font-medium">Número de serie</label>
                <select id="mat-eq" value={equipo} onChange={(e) => setEquipo(e.target.value)} className="min-h-12 rounded-md border border-linea bg-superficie px-3">
                  <option value="">Elegir equipo…</option>
                  {stock.data.equipos.filter((x) => x.articulo_id === elegido.articulo_id).map((x) => (
                    <option key={x.id} value={x.id}>{x.numero_serie}</option>
                  ))}
                </select>
              </>
            ) : (
              <Campo id="mat-cant" etiqueta={`Cantidad (${elegido.articulos?.unidad === 'metro' ? 'metros' : 'unidades'})`}
                type="number" inputMode="decimal" min={0} step="any" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
            ))}
            {registrar.isError && <Aviso tipo="error">{mensajeError(registrar.error)}</Aviso>}
            <Boton className="min-h-12 self-start" disabled={!valido} cargando={registrar.isPending} onClick={() => registrar.mutate()}>
              Registrar material
            </Boton>
          </div>
        )
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// Cierre
// ---------------------------------------------------------------------
export function CierreOrden({ o, alCerrar }: { o: OrdenVista; alCerrar: (r: { cliente_id?: string }) => void }) {
  const rango = useQuery({ queryKey: ['configuracion', 'potencia'], queryFn: rangoPotencia, staleTime: 10 * 60_000 });
  const [exito, setExito] = useState(true);
  const [ont, setOnt] = useState('');
  const [nap, setNap] = useState('');
  const [resultado, setResultado] = useState('');
  const [conformidad, setConformidad] = useState<boolean | null>(null);
  const [obs, setObs] = useState('');
  const [serie, setSerie] = useState('');
  const [gps, setGps] = useState<{ lng: number; lat: number } | null>(null);
  const [errorGps, setErrorGps] = useState('');

  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
  const potencia = num(ont);
  const fueraDeRango = rango.data && potencia != null && (potencia < rango.data.min || potencia > rango.data.max);
  const esInstalacion = o.tipo === 'instalacion';

  const cerrar = useMutation({
    mutationFn: () =>
      cerrarOrden(o.id, {
        exito,
        potencia_ont_dbm: potencia,
        potencia_nap_dbm: num(nap),
        resultado_pruebas: resultado,
        conformidad_cliente: conformidad,
        observaciones: obs,
        numero_serie_ont: serie,
        lng: gps?.lng ?? null,
        lat: gps?.lat ?? null,
      }),
    onSuccess: (r) => alCerrar(r),
  });

  function capturarGps() {
    setErrorGps('');
    navigator.geolocation.getCurrentPosition(
      (p) => setGps({ lng: p.coords.longitude, lat: p.coords.latitude }),
      () => setErrorGps('No se pudo obtener la ubicación.'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  const requierePotencia = exito && (esInstalacion || o.tipo === 'reparacion' || o.tipo === 'cambio_domicilio');
  const valido = (!requierePotencia || potencia != null) && (potencia == null || (potencia > -50 && potencia < 10));

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-cond text-xl font-semibold">Cerrar orden</h2>
      <div className="flex rounded-md border border-linea" role="radiogroup" aria-label="Resultado">
        <button type="button" role="radio" aria-checked={exito} onClick={() => setExito(true)}
          className={`min-h-12 flex-1 rounded-l-md font-semibold ${exito ? 'bg-ok text-white' : ''}`}>Trabajo realizado</button>
        <button type="button" role="radio" aria-checked={!exito} onClick={() => setExito(false)}
          className={`min-h-12 flex-1 rounded-r-md font-semibold ${!exito ? 'bg-error text-white' : ''}`}>No se pudo realizar</button>
      </div>
      {esInstalacion && (
        <p className="text-sm text-tenue">
          {exito
            ? 'Al cerrar, el cliente queda activo y el puerto reservado pasa a ocupado.'
            : 'La reserva del puerto se mantiene para reprogramar la instalación.'}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Campo id="c-ont" etiqueta="Potencia en ONT (dBm)" type="number" inputMode="decimal" step="0.01" value={ont}
          onChange={(e) => setOnt(e.target.value)}
          error={fueraDeRango ? `Fuera del rango aceptable (${rango.data!.min} a ${rango.data!.max} dBm)` : undefined}
          ayuda={rango.data ? `Aceptable: ${rango.data.min} a ${rango.data.max} dBm` : undefined} />
        <Campo id="c-nap" etiqueta="Potencia en NAP (dBm)" type="number" inputMode="decimal" step="0.01" value={nap} onChange={(e) => setNap(e.target.value)} />
      </div>
      {esInstalacion && exito && (
        <Campo id="c-serie" etiqueta="N.º de serie de la ONT instalada" value={serie} onChange={(e) => setSerie(e.target.value)} />
      )}
      <AreaTexto id="c-res" etiqueta="Resultado de las pruebas" rows={2} value={resultado} onChange={(e) => setResultado(e.target.value)} />
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Conformidad del cliente</legend>
        <div className="flex gap-4">
          <label className="flex items-center gap-2"><input type="radio" name="conf" checked={conformidad === true} onChange={() => setConformidad(true)} /> Conforme</label>
          <label className="flex items-center gap-2"><input type="radio" name="conf" checked={conformidad === false} onChange={() => setConformidad(false)} /> No conforme</label>
          <label className="flex items-center gap-2"><input type="radio" name="conf" checked={conformidad === null} onChange={() => setConformidad(null)} /> No aplica</label>
        </div>
      </fieldset>
      <AreaTexto id="c-obs" etiqueta="Observaciones" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
      <div>
        <Boton variante="secundario" className="min-h-12" onClick={capturarGps}>
          <MapPin className="size-5" aria-hidden /> {gps ? 'Ubicación registrada' : 'Registrar ubicación de cierre'}
        </Boton>
        {gps && <p className="cifra mt-1 text-sm text-tenue">{gps.lat.toFixed(6)}, {gps.lng.toFixed(6)}</p>}
        {errorGps && <p className="mt-1 text-sm text-error">{errorGps}</p>}
      </div>
      {requierePotencia && potencia == null && <p className="text-sm text-tenue">Registre la potencia medida en la ONT para cerrar.</p>}
      {cerrar.isError && <Aviso tipo="error">{mensajeError(cerrar.error)}</Aviso>}
      <Boton className="min-h-12" disabled={!valido} cargando={cerrar.isPending}
        onClick={() => window.confirm('¿Cerrar la orden? Después no se puede modificar.') && cerrar.mutate()}>
        Cerrar orden
      </Boton>
    </section>
  );
}

export function DatosCierre({ o }: { o: OrdenVista }) {
  if (o.estado !== 'completada') return null;
  return (
    <section>
      <h2 className="mb-1 font-cond text-xl font-semibold">Cierre</h2>
      <dl className="grid grid-cols-[9rem_1fr] gap-y-1.5 text-[15px]">
        <dt className="text-tenue">Cerrada</dt><dd>{formatearFechaHora(o.cerrada_en)}</dd>
        <dt className="text-tenue">Potencia ONT</dt><dd className="cifra">{o.potencia_ont_dbm != null ? `${o.potencia_ont_dbm} dBm` : '—'}</dd>
        <dt className="text-tenue">Potencia NAP</dt><dd className="cifra">{o.potencia_nap_dbm != null ? `${o.potencia_nap_dbm} dBm` : '—'}</dd>
        <dt className="text-tenue">Resultado</dt><dd>{o.resultado_pruebas ?? '—'}</dd>
        <dt className="text-tenue">Conformidad</dt><dd>{o.conformidad_cliente == null ? 'No aplica' : o.conformidad_cliente ? 'Conforme' : 'No conforme'}</dd>
      </dl>
    </section>
  );
}
