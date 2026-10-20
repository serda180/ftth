import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { LocateFixed, TriangleAlert } from 'lucide-react';
import { esRutValido, formatearRut } from '../lib/rut';
import { formatearTelefono } from '../lib/formato';
import { mensajeError } from '../lib/errores';
import { AreaTexto, Aviso, Boton, Campo, Cargando, EncabezadoPagina, Selector } from '../components/ui';
import { MiniMapa } from '../components/MiniMapa';
import {
  ESTADOS_CLIENTE,
  actualizarCliente,
  cargarPlanesYComunas,
  clientesSimilares,
  coordenadasCliente,
  crearCliente,
  obtenerCliente,
  type DatosCliente,
} from './api';

const VACIO: DatosCliente = {
  nombre: '',
  rut: '',
  telefono: '',
  whatsapp: '',
  email: '',
  direccion_calle: '',
  direccion_numero: '',
  direccion_depto: '',
  comuna_id: null,
  referencia: '',
  plan_id: null,
  precio_mensual_clp: null,
  fecha_contratacion: '',
  numero_contrato: '',
  estado: 'pendiente',
  numero_serie_ont: '',
  observaciones: '',
};

const telefonoValido = (t: string) => {
  const d = t.replace(/\D/g, '');
  return t.trim() === '' || /^(56)?[2-9]\d{8}$/.test(d);
};
const emailValido = (e: string) => e.trim() === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());

/** Crear o editar un cliente (ruta /clientes/nuevo o /clientes/:id/editar). */
export function FormCliente() {
  const { id } = useParams();
  const editando = !!id;
  const navegar = useNavigate();
  const qc = useQueryClient();

  const catalogos = useQuery({ queryKey: ['clientes', 'catalogos'], queryFn: cargarPlanesYComunas, staleTime: 5 * 60_000 });
  const existente = useQuery({
    queryKey: ['clientes', 'detalle', id],
    queryFn: async () => {
      const [c, u] = await Promise.all([obtenerCliente(id!), coordenadasCliente(id!)]);
      return { c, u };
    },
    enabled: editando,
  });

  const [d, setD] = useState<DatosCliente>(VACIO);
  const [ubicacion, setUbicacion] = useState<{ lng: number; lat: number } | null>(null);
  const [cargado, setCargado] = useState(!editando);
  const [tocado, setTocado] = useState<Record<string, boolean>>({});
  const [errorUbicar, setErrorUbicar] = useState('');

  useEffect(() => {
    const c = existente.data?.c;
    if (!c || cargado) return;
    setD({
      nombre: c.nombre,
      rut: formatearRut(c.rut),
      telefono: c.telefono ? formatearTelefono(c.telefono) : '',
      whatsapp: c.whatsapp ? formatearTelefono(c.whatsapp) : '',
      email: c.email ?? '',
      direccion_calle: c.direccion_calle,
      direccion_numero: c.direccion_numero ?? '',
      direccion_depto: c.direccion_depto ?? '',
      comuna_id: c.comuna_id,
      referencia: c.referencia ?? '',
      plan_id: c.plan_id,
      precio_mensual_clp: c.precio_mensual_clp,
      fecha_contratacion: c.fecha_contratacion ?? '',
      numero_contrato: c.numero_contrato ?? '',
      estado: c.estado,
      numero_serie_ont: c.numero_serie_ont ?? '',
      observaciones: c.observaciones ?? '',
    });
    setUbicacion(existente.data?.u ?? null);
    setCargado(true);
  }, [existente.data, cargado]);

  // Posibles duplicados (mismo RUT o misma dirección): advierte, no bloquea.
  const [claveDuplicados, setClaveDuplicados] = useState('');
  useEffect(() => {
    const t = window.setTimeout(
      () => setClaveDuplicados(JSON.stringify([d.rut, d.direccion_calle, d.direccion_numero, d.comuna_id])),
      600,
    );
    return () => window.clearTimeout(t);
  }, [d.rut, d.direccion_calle, d.direccion_numero, d.comuna_id]);
  const similares = useQuery({
    queryKey: ['clientes', 'similares', claveDuplicados, id],
    queryFn: () => clientesSimilares(d.rut, d.direccion_calle, d.direccion_numero, d.comuna_id, id),
    enabled: cargado && (esRutValido(d.rut) || (d.direccion_calle.trim().length > 2 && d.comuna_id != null)),
  });

  const guardar = useMutation({
    mutationFn: async () => {
      if (id) {
        await actualizarCliente(id, d, ubicacion);
        return id;
      }
      return crearCliente(d, ubicacion);
    },
    onSuccess: async (nuevoId) => {
      await qc.invalidateQueries({ queryKey: ['clientes'] });
      navegar(`/clientes/${nuevoId}`);
    },
  });

  const errores = {
    nombre: d.nombre.trim().length < 2 ? 'Indique el nombre o razón social.' : '',
    rut: !esRutValido(d.rut) ? 'RUT no válido: revise el dígito verificador.' : '',
    telefono: !telefonoValido(d.telefono) ? 'Use un teléfono chileno, por ejemplo +56 9 1234 5678.' : '',
    whatsapp: !telefonoValido(d.whatsapp) ? 'Use un número chileno, por ejemplo +56 9 1234 5678.' : '',
    email: !emailValido(d.email) ? 'Revise el formato del correo.' : '',
    direccion_calle: d.direccion_calle.trim().length < 2 ? 'Indique la calle.' : '',
    comuna_id: d.comuna_id == null ? 'Elija la comuna.' : '',
    plan_id: d.estado === 'activo' && d.plan_id == null ? 'Un cliente activo necesita un plan.' : '',
    ubicacion: !editando && !ubicacion ? 'Marque la ubicación de la instalación en el mapa.' : '',
  };
  const hayErrores = Object.values(errores).some(Boolean);
  const error = (k: keyof typeof errores) => (tocado[k] || tocado._enviar ? errores[k] || undefined : undefined);
  const tocar = (k: string) => setTocado((t) => ({ ...t, [k]: true }));

  function enviar(e: FormEvent) {
    e.preventDefault();
    setTocado((t) => ({ ...t, _enviar: true }));
    if (!hayErrores) guardar.mutate();
  }

  function usarMiUbicacion() {
    setErrorUbicar('');
    navigator.geolocation.getCurrentPosition(
      (p) => setUbicacion({ lng: p.coords.longitude, lat: p.coords.latitude }),
      () => setErrorUbicar('No se pudo obtener su ubicación. Revise el permiso del navegador.'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  if (catalogos.isPending || (editando && !cargado && existente.isPending)) return <Cargando />;
  if (catalogos.isError) return <Aviso tipo="error">{mensajeError(catalogos.error)}</Aviso>;
  if (editando && existente.data && !existente.data.c) return <Aviso tipo="error">El cliente no existe o no tiene acceso.</Aviso>;
  const cat = catalogos.data;
  const plan = cat.planes.find((p) => p.id === d.plan_id);

  return (
    <>
      <EncabezadoPagina
        titulo={editando ? `Editar ${d.nombre || 'cliente'}` : 'Nuevo cliente'}
        detalle={editando ? undefined : 'El código de cliente se asigna solo. El puerto de NAP se asigna después, desde la ficha.'}
      />
      <form onSubmit={enviar} noValidate className="grid max-w-5xl gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h2 className="font-cond text-xl font-semibold">Datos del cliente</h2>
          <Campo id="c-nombre" etiqueta="Nombre completo o razón social" value={d.nombre}
            onChange={(e) => setD({ ...d, nombre: e.target.value })} onBlur={() => tocar('nombre')} error={error('nombre')} />
          <Campo id="c-rut" etiqueta="RUT" value={d.rut} placeholder="12.345.678-5"
            onChange={(e) => setD({ ...d, rut: e.target.value })}
            onBlur={() => { tocar('rut'); if (esRutValido(d.rut)) setD((x) => ({ ...x, rut: formatearRut(x.rut) })); }}
            error={error('rut')} />
          <div className="grid grid-cols-2 gap-3">
            <Campo id="c-tel" etiqueta="Teléfono" type="tel" inputMode="tel" value={d.telefono}
              onChange={(e) => setD({ ...d, telefono: e.target.value })} onBlur={() => tocar('telefono')} error={error('telefono')} />
            <Campo id="c-wsp" etiqueta="WhatsApp" type="tel" inputMode="tel" value={d.whatsapp}
              onChange={(e) => setD({ ...d, whatsapp: e.target.value })} onBlur={() => tocar('whatsapp')} error={error('whatsapp')} />
          </div>
          {d.telefono && !d.whatsapp && telefonoValido(d.telefono) && (
            <button type="button" className="-mt-2 self-start text-sm text-acento hover:underline"
              onClick={() => setD({ ...d, whatsapp: d.telefono })}>
              Usar el mismo número para WhatsApp
            </button>
          )}
          <Campo id="c-email" etiqueta="Correo" type="email" value={d.email}
            onChange={(e) => setD({ ...d, email: e.target.value })} onBlur={() => tocar('email')} error={error('email')} />

          <h2 className="mt-4 font-cond text-xl font-semibold">Servicio</h2>
          <div className="grid grid-cols-2 gap-3">
            <Selector id="c-plan" etiqueta="Plan" value={d.plan_id ?? ''} vacio="Sin plan"
              onChange={(e) => {
                const planId = e.target.value ? Number(e.target.value) : null;
                const p = cat.planes.find((x) => x.id === planId);
                setD({ ...d, plan_id: planId, precio_mensual_clp: d.precio_mensual_clp ?? p?.precio_clp ?? null });
              }}
              opciones={cat.planes.filter((p) => p.activo || p.id === d.plan_id).map((p) => ({ valor: p.id, texto: `${p.nombre} (${p.bajada_mbps}/${p.subida_mbps} Mbps)` }))}
              error={error('plan_id')} />
            <Campo id="c-precio" etiqueta="Precio mensual (CLP)" type="number" min={0} step={1} inputMode="numeric"
              value={d.precio_mensual_clp ?? ''}
              onChange={(e) => setD({ ...d, precio_mensual_clp: e.target.value ? Math.round(Number(e.target.value)) : null })}
              ayuda={plan ? `Precio de lista: $${plan.precio_clp.toLocaleString('es-CL')}` : undefined} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Selector id="c-estado" etiqueta="Estado" value={d.estado}
              onChange={(e) => setD({ ...d, estado: e.target.value as DatosCliente['estado'] })}
              opciones={ESTADOS_CLIENTE.filter((x) => editando || x.valor !== 'retirado').map((x) => ({ valor: x.valor, texto: x.nombre }))} />
            <Campo id="c-fecha" etiqueta="Fecha de contratación" type="date" value={d.fecha_contratacion}
              onChange={(e) => setD({ ...d, fecha_contratacion: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo id="c-contrato" etiqueta="N.º de contrato" value={d.numero_contrato}
              onChange={(e) => setD({ ...d, numero_contrato: e.target.value })} />
            <Campo id="c-ont" etiqueta="N.º de serie ONT" value={d.numero_serie_ont}
              onChange={(e) => setD({ ...d, numero_serie_ont: e.target.value })} />
          </div>
          <AreaTexto id="c-obs" etiqueta="Observaciones" value={d.observaciones}
            onChange={(e) => setD({ ...d, observaciones: e.target.value })} />
        </div>

        <div className="flex flex-col gap-4">
          <h2 className="font-cond text-xl font-semibold">Dirección de instalación</h2>
          <div className="grid grid-cols-[minmax(0,1fr)_6rem_6rem] gap-3">
            <Campo id="c-calle" etiqueta="Calle" value={d.direccion_calle}
              onChange={(e) => setD({ ...d, direccion_calle: e.target.value })} onBlur={() => tocar('direccion_calle')} error={error('direccion_calle')} />
            <Campo id="c-num" etiqueta="Número" value={d.direccion_numero} onChange={(e) => setD({ ...d, direccion_numero: e.target.value })} />
            <Campo id="c-depto" etiqueta="Depto/casa" value={d.direccion_depto} onChange={(e) => setD({ ...d, direccion_depto: e.target.value })} />
          </div>
          <Selector id="c-comuna" etiqueta="Comuna" value={d.comuna_id ?? ''} vacio="Elegir…"
            onChange={(e) => { setD({ ...d, comuna_id: e.target.value ? Number(e.target.value) : null }); tocar('comuna_id'); }}
            opciones={cat.comunas.map((c) => ({ valor: c.id, texto: c.nombre }))} error={error('comuna_id')} />
          <Campo id="c-ref" etiqueta="Referencia" value={d.referencia} placeholder="Ej.: portón verde, frente a la plaza"
            onChange={(e) => setD({ ...d, referencia: e.target.value })} />

          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-sm font-medium">Ubicación exacta</p>
              <button type="button" onClick={usarMiUbicacion} className="inline-flex items-center gap-1.5 text-sm text-acento hover:underline">
                <LocateFixed className="size-4" aria-hidden /> Usar mi ubicación
              </button>
            </div>
            <MiniMapa valor={ubicacion} centro={cat.centro} alCambiar={setUbicacion} alto={300} />
            <p className={`mt-1 text-sm ${error('ubicacion') ? 'text-error' : 'text-tenue'}`}>
              {error('ubicacion') ??
                (ubicacion
                  ? `${ubicacion.lat.toFixed(6)}, ${ubicacion.lng.toFixed(6)} · toque el mapa o arrastre el punto para corregir.`
                  : 'Toque el mapa en el lugar de la instalación.')}
            </p>
            {errorUbicar && <p className="mt-1 text-sm text-error">{errorUbicar}</p>}
          </div>

          {similares.data && similares.data.length > 0 && (
            <div className="rounded-md border border-alerta/40 bg-alerta/5 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium text-alerta">
                <TriangleAlert className="size-4" aria-hidden /> Posibles duplicados
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {similares.data.map((s) => (
                  <li key={s.id}>
                    <Link to={`/clientes/${s.id}`} target="_blank" className="text-acento hover:underline">{s.nombre}</Link>{' '}
                    ({s.codigo}, {s.estado}) — mismo {s.motivo === 'rut' ? 'RUT' : 'domicilio'}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-tenue">Puede guardar igual si se trata de otro servicio.</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 lg:col-span-2">
          {tocado._enviar && hayErrores && <Aviso tipo="error">Revise los campos marcados.</Aviso>}
          {guardar.isError && <Aviso tipo="error">{mensajeError(guardar.error)}</Aviso>}
          <div className="flex gap-3">
            <Boton type="submit" cargando={guardar.isPending}>{editando ? 'Guardar cambios' : 'Registrar cliente'}</Boton>
            <Boton type="button" variante="secundario" onClick={() => navegar(editando ? `/clientes/${id}` : '/clientes')}>Cancelar</Boton>
          </div>
        </div>
      </form>
    </>
  );
}
