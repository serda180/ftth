import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { LocateFixed } from 'lucide-react';
import { esRutValido, formatearRut } from '../lib/rut';
import { formatearTelefono } from '../lib/formato';
import { mensajeError } from '../lib/errores';
import { AreaTexto, Aviso, Boton, Campo, Cargando, EncabezadoPagina, Selector } from '../components/ui';
import { MiniMapa } from '../components/MiniMapa';
import { cargarPlanesYComunas } from '../clientes/api';
import { CANALES, actualizarSolicitud, crearSolicitud, obtenerSolicitud, type DatosSolicitud } from './api';

const VACIA: DatosSolicitud = {
  canal: 'telefono',
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
  observaciones: '',
};

const telValido = (t: string) => t.trim() === '' || /^(56)?[2-9]\d{8}$/.test(t.replace(/\D/g, ''));

export function FormSolicitud() {
  const { id } = useParams();
  const navegar = useNavigate();
  const qc = useQueryClient();
  const catalogos = useQuery({ queryKey: ['clientes', 'catalogos'], queryFn: cargarPlanesYComunas, staleTime: 5 * 60_000 });
  const existente = useQuery({ queryKey: ['solicitudes', 'detalle', id], queryFn: () => obtenerSolicitud(id!), enabled: !!id });

  const [d, setD] = useState<DatosSolicitud>(VACIA);
  const [u, setU] = useState<{ lng: number; lat: number } | null>(null);
  const [cargada, setCargada] = useState(!id);
  const [enviado, setEnviado] = useState(false);

  useEffect(() => {
    const s = existente.data;
    if (!s || cargada) return;
    setD({
      canal: s.canal,
      nombre: s.nombre,
      rut: s.rut ? formatearRut(s.rut) : '',
      telefono: s.telefono ? formatearTelefono(s.telefono) : '',
      whatsapp: s.whatsapp ? formatearTelefono(s.whatsapp) : '',
      email: s.email ?? '',
      direccion_calle: s.direccion_calle,
      direccion_numero: s.direccion_numero ?? '',
      direccion_depto: s.direccion_depto ?? '',
      comuna_id: s.comuna_id,
      referencia: s.referencia ?? '',
      plan_id: s.plan_id,
      observaciones: s.observaciones ?? '',
    });
    setU(s.lng != null && s.lat != null ? { lng: s.lng, lat: s.lat } : null);
    setCargada(true);
  }, [existente.data, cargada]);

  const guardar = useMutation({
    mutationFn: async () => {
      if (id) {
        await actualizarSolicitud(id, d, u);
        return id;
      }
      return crearSolicitud(d, u);
    },
    onSuccess: async (nuevo) => {
      await qc.invalidateQueries({ queryKey: ['solicitudes'] });
      navegar(`/solicitudes/${nuevo}`);
    },
  });

  const errores = {
    nombre: d.nombre.trim().length < 2 ? 'Indique el nombre.' : '',
    rut: d.rut.trim() && !esRutValido(d.rut) ? 'RUT no válido.' : '',
    telefono: !telValido(d.telefono) ? 'Teléfono chileno, ej.: +56 9 1234 5678.' : '',
    whatsapp: !telValido(d.whatsapp) ? 'Número chileno, ej.: +56 9 1234 5678.' : '',
    contacto: !d.telefono.trim() && !d.whatsapp.trim() && !d.email.trim() ? 'Registre al menos un medio de contacto.' : '',
    direccion: d.direccion_calle.trim().length < 2 ? 'Indique la calle.' : '',
    comuna: d.comuna_id == null ? 'Elija la comuna.' : '',
  };
  const hayErrores = Object.values(errores).some(Boolean);
  const err = (k: keyof typeof errores) => (enviado ? errores[k] || undefined : undefined);

  function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviado(true);
    if (!hayErrores) guardar.mutate();
  }

  if (catalogos.isPending || (id && !cargada)) return <Cargando />;
  if (catalogos.isError) return <Aviso tipo="error">{mensajeError(catalogos.error)}</Aviso>;
  const cat = catalogos.data;

  return (
    <>
      <EncabezadoPagina
        titulo={id ? 'Editar solicitud' : 'Nueva solicitud'}
        detalle="El RUT y el plan pueden completarse después, pero son necesarios para generar la orden de instalación."
      />
      <form onSubmit={enviar} noValidate className="grid max-w-5xl gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Selector id="s-canal" etiqueta="Canal de contacto" value={d.canal} onChange={(e) => setD({ ...d, canal: e.target.value })}
              opciones={CANALES.map((c) => ({ valor: c.valor, texto: c.nombre }))} />
            <Selector id="s-plan" etiqueta="Plan de interés" value={d.plan_id ?? ''} vacio="Sin definir"
              onChange={(e) => setD({ ...d, plan_id: e.target.value ? Number(e.target.value) : null })}
              opciones={cat.planes.filter((p) => p.activo).map((p) => ({ valor: p.id, texto: `${p.nombre} ($${p.precio_clp.toLocaleString('es-CL')})` }))} />
          </div>
          <Campo id="s-nombre" etiqueta="Nombre" value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} error={err('nombre')} />
          <Campo id="s-rut" etiqueta="RUT (opcional por ahora)" value={d.rut} onChange={(e) => setD({ ...d, rut: e.target.value })}
            onBlur={() => esRutValido(d.rut) && setD((x) => ({ ...x, rut: formatearRut(x.rut) }))} error={err('rut')} />
          <div className="grid grid-cols-2 gap-3">
            <Campo id="s-tel" etiqueta="Teléfono" type="tel" value={d.telefono} onChange={(e) => setD({ ...d, telefono: e.target.value })} error={err('telefono')} />
            <Campo id="s-wsp" etiqueta="WhatsApp" type="tel" value={d.whatsapp} onChange={(e) => setD({ ...d, whatsapp: e.target.value })} error={err('whatsapp')} />
          </div>
          <Campo id="s-email" etiqueta="Correo" type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} />
          {err('contacto') && <p className="-mt-2 text-sm text-error">{err('contacto')}</p>}
          <AreaTexto id="s-obs" etiqueta="Observaciones" value={d.observaciones} onChange={(e) => setD({ ...d, observaciones: e.target.value })} />
        </div>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[minmax(0,1fr)_6rem_6rem] gap-3">
            <Campo id="s-calle" etiqueta="Calle" value={d.direccion_calle} onChange={(e) => setD({ ...d, direccion_calle: e.target.value })} error={err('direccion')} />
            <Campo id="s-num" etiqueta="Número" value={d.direccion_numero} onChange={(e) => setD({ ...d, direccion_numero: e.target.value })} />
            <Campo id="s-depto" etiqueta="Depto/casa" value={d.direccion_depto} onChange={(e) => setD({ ...d, direccion_depto: e.target.value })} />
          </div>
          <Selector id="s-comuna" etiqueta="Comuna" value={d.comuna_id ?? ''} vacio="Elegir…" error={err('comuna')}
            onChange={(e) => setD({ ...d, comuna_id: e.target.value ? Number(e.target.value) : null })}
            opciones={cat.comunas.map((c) => ({ valor: c.id, texto: c.nombre }))} />
          <Campo id="s-ref" etiqueta="Referencia" value={d.referencia} onChange={(e) => setD({ ...d, referencia: e.target.value })} />
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-sm font-medium">Ubicación</p>
              <button type="button" className="inline-flex items-center gap-1.5 text-sm text-acento hover:underline"
                onClick={() => navigator.geolocation.getCurrentPosition((p) => setU({ lng: p.coords.longitude, lat: p.coords.latitude }))}>
                <LocateFixed className="size-4" aria-hidden /> Usar mi ubicación
              </button>
            </div>
            <MiniMapa valor={u} centro={cat.centro} alCambiar={setU} alto={300} />
            <p className="mt-1 text-sm text-tenue">
              {u ? 'Toque el mapa o arrastre el punto para corregir.' : 'Toque el mapa en el lugar de la instalación. Sin ubicación no se puede evaluar la factibilidad.'}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3 lg:col-span-2">
          {enviado && hayErrores && <Aviso tipo="error">Revise los campos marcados.</Aviso>}
          {guardar.isError && <Aviso tipo="error">{mensajeError(guardar.error)}</Aviso>}
          <div className="flex gap-3">
            <Boton type="submit" cargando={guardar.isPending}>{id ? 'Guardar cambios' : 'Registrar solicitud'}</Boton>
            <Boton type="button" variante="secundario" onClick={() => navegar(id ? `/solicitudes/${id}` : '/solicitudes')}>Cancelar</Boton>
          </div>
        </div>
      </form>
    </>
  );
}
