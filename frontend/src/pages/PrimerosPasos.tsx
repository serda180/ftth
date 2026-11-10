import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Circle, MapPin } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { mensajeError } from '../lib/errores';
import { tieneRol } from '../lib/roles';
import { Aviso, Boton, Campo, Cargando, EncabezadoPagina } from '../components/ui';
import { MiniMapa } from '../components/MiniMapa';
import { Planes } from './Configuracion';

export type EstadoPrimerosPasos = {
  completo: boolean;
  empresa: boolean;
  planes: number;
  olt: number;
  troncales: number;
  nap: number;
  usuarios: number;
  demo: boolean;
};

/** Avance del asistente (solo para administradores; null mientras carga o para otros roles). */
export function usePrimerosPasos() {
  const { session, roles } = useAuth();
  const esAdmin = roles.includes('administrador');
  return useQuery({
    queryKey: ['primeros-pasos'],
    enabled: session != null && esAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('estado_primeros_pasos');
      if (error) throw error;
      return data as EstadoPrimerosPasos;
    },
    staleTime: 15_000,
  });
}

type Centro = { lat: number; lng: number; zoom: number };

export function PrimerosPasos() {
  const { roles } = useAuth();
  const estado = usePrimerosPasos();
  const qc = useQueryClient();
  const navegar = useNavigate();

  const terminar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('configuracion').update({ valor: true }).eq('clave', 'configuracion_inicial');
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['primeros-pasos'] });
      navegar('/');
    },
  });

  if (!tieneRol(roles, 'administrador')) return null;
  if (estado.isPending) return <Cargando />;
  if (estado.isError) return <Aviso tipo="error">{mensajeError(estado.error)}</Aviso>;
  const e = estado.data;
  const redLista = e.olt > 0 && e.troncales > 0 && e.nap > 0;

  return (
    <div className="mx-auto max-w-3xl">
      <EncabezadoPagina
        titulo="Primeros pasos"
        detalle="Configure su empresa y cree su red desde cero. Puede volver aquí cuando quiera desde Configuración."
      />

      {e.demo && <PasoDemo />}

      <ol className="flex flex-col gap-6">
        <Paso numero={1} titulo="Su empresa y zona de trabajo" hecho={e.empresa}>
          <FormEmpresa />
        </Paso>

        <Paso numero={2} titulo="Planes comerciales" hecho={e.planes > 0}>
          <p className="mb-4 text-tenue">
            Los planes que vende (velocidad y precio en pesos). Se eligen al registrar cada cliente.
          </p>
          <Planes />
        </Paso>

        <Paso numero={3} titulo="Su red en el mapa" hecho={redLista}>
          <p className="mb-4 text-tenue">
            Dibuje la red en este orden. Cada elemento se ubica tocando el mapa; los cables se trazan punto a punto y se
            ajustan solos a los elementos cercanos.
          </p>
          <ul className="mb-5 flex flex-col gap-3">
            <ItemRed hecho={e.olt > 0} cantidad={e.olt} titulo="OLT">
              En el mapa, <strong>Agregar elemento → OLT</strong>, en la central. Indique cuántos puertos PON tiene.
            </ItemRed>
            <ItemRed hecho={e.troncales > 0} cantidad={e.troncales} titulo="Cable troncal">
              <strong>Dibujar cable</strong>, tipo <strong>troncal</strong>, desde la OLT por el recorrido real
              (postes o cámaras). Los hilos se crean solos con sus colores.
            </ItemRed>
            <ItemRed hecho={e.nap > 0} cantidad={e.nap} titulo="NAP">
              <strong>Agregar elemento → NAP</strong> junto al troncal y elija el <strong>ratio del splitter</strong>{' '}
              (1:8, 1:16…). Luego, en la ficha de la NAP, conéctela a un hilo del troncal.
            </ItemRed>
          </ul>
          <Link
            to="/mapa"
            className="inline-flex items-center gap-2 rounded-md bg-acento px-4 py-2 font-medium text-white hover:opacity-90"
          >
            <MapPin className="size-4" aria-hidden /> Abrir el mapa
          </Link>
          <p className="mt-3 text-sm text-tenue">Al volver a esta página verá marcado lo que ya creó.</p>
        </Paso>

        <Paso numero={4} titulo="Su equipo" hecho={e.usuarios > 1}>
          <p className="mb-4 text-tenue">
            Invite a técnicos, supervisores y atención al cliente. Cada persona recibe un enlace para crear su
            contraseña; puede compartirlo por WhatsApp.
          </p>
          <Link to="/usuarios" className="font-medium text-acento hover:underline">
            Ir a Usuarios
          </Link>
        </Paso>
      </ol>

      <div className="mt-10 flex flex-col items-start gap-3 border-t border-linea pt-6">
        {!(e.empresa && e.planes > 0) && (
          <p className="text-sm text-tenue">Complete al menos su empresa y un plan para terminar.</p>
        )}
        {terminar.isError && <Aviso tipo="error">{mensajeError(terminar.error)}</Aviso>}
        <Boton cargando={terminar.isPending} disabled={!(e.empresa && e.planes > 0)} onClick={() => terminar.mutate()}>
          {e.completo ? 'Volver al panel' : 'Terminar y ir al panel'}
        </Boton>
      </div>
    </div>
  );
}

function Paso({ numero, titulo, hecho, children }: { numero: number; titulo: string; hecho: boolean; children: ReactNode }) {
  return (
    <li className="rounded-md border border-linea bg-superficie p-5">
      <h2 className="mb-3 flex items-center gap-3 font-cond text-xl font-semibold">
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-full text-base ${
            hecho ? 'bg-[#2e8540] text-white' : 'border border-linea text-tenue'
          }`}
          aria-hidden
        >
          {hecho ? <Check className="size-4" /> : numero}
        </span>
        {titulo}
        {hecho && <span className="sr-only">(listo)</span>}
      </h2>
      {children}
    </li>
  );
}

function ItemRed({ hecho, cantidad, titulo, children }: { hecho: boolean; cantidad: number; titulo: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      {hecho ? (
        <Check className="mt-0.5 size-5 shrink-0 text-[#2e8540]" aria-label="Listo" />
      ) : (
        <Circle className="mt-0.5 size-5 shrink-0 text-tenue" aria-label="Pendiente" />
      )}
      <div>
        <p className="font-medium">
          {titulo} {cantidad > 0 && <span className="cifra text-sm font-normal text-tenue">({cantidad})</span>}
        </p>
        <p className="text-sm text-tenue">{children}</p>
      </div>
    </li>
  );
}

function PasoDemo() {
  const qc = useQueryClient();
  const borrar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('eliminar_datos_demo');
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
  return (
    <div className="mb-6 rounded-md border border-[#c98a00] bg-superficie p-5">
      <h2 className="font-cond text-xl font-semibold">Hay datos de demostración</h2>
      <p className="mt-1 text-tenue">
        La plataforma tiene una red de ejemplo (nombres que empiezan con DEMO). Bórrela para partir con su red real;
        solo se elimina lo marcado como demostración.
      </p>
      {borrar.isError && <div className="mt-3"><Aviso tipo="error">{mensajeError(borrar.error)}</Aviso></div>}
      <Boton
        className="mt-4"
        variante="secundario"
        cargando={borrar.isPending}
        onClick={() => {
          if (window.confirm('¿Borrar todos los datos de demostración? No afecta lo que usted haya creado.')) borrar.mutate();
        }}
      >
        Borrar datos de demostración
      </Boton>
    </div>
  );
}

function FormEmpresa() {
  const qc = useQueryClient();
  const actual = useQuery({
    queryKey: ['configuracion', 'empresa-y-centro'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('configuracion')
        .select('clave, valor')
        .in('clave', ['nombre_empresa', 'mapa_centro']);
      if (error) throw error;
      const m = new Map(data.map((f) => [f.clave as string, f.valor as unknown]));
      return {
        nombre: (m.get('nombre_empresa') as string | null) ?? '',
        centro: (m.get('mapa_centro') as Centro | null) ?? { lat: -36.827, lng: -73.0503, zoom: 13 },
      };
    },
  });
  const [nombre, setNombre] = useState('');
  const [punto, setPunto] = useState<{ lat: number; lng: number } | null>(null);
  const [aviso, setAviso] = useState('');
  const [guardado, setGuardado] = useState(false);

  useEffect(() => {
    if (actual.data) setNombre(actual.data.nombre);
  }, [actual.data]);

  const guardar = useMutation({
    mutationFn: async () => {
      const { error: e1 } = await supabase.from('configuracion').update({ valor: nombre.trim() }).eq('clave', 'nombre_empresa');
      if (e1) throw e1;
      if (punto) {
        const centro: Centro = { lat: Number(punto.lat.toFixed(6)), lng: Number(punto.lng.toFixed(6)), zoom: 14 };
        const { error: e2 } = await supabase.from('configuracion').update({ valor: centro }).eq('clave', 'mapa_centro');
        if (e2) throw e2;
      }
    },
    onSuccess: async () => {
      setGuardado(true);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['configuracion'] }),
        qc.invalidateQueries({ queryKey: ['primeros-pasos'] }),
        qc.invalidateQueries({ queryKey: ['mapa', 'catalogos'] }),
        qc.invalidateQueries({ queryKey: ['clientes', 'catalogos'] }),
      ]);
    },
  });

  function ubicarme() {
    setAviso('');
    if (!('geolocation' in navigator)) {
      setAviso('Este navegador no puede obtener la ubicación. Toque el mapa en su zona.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => setPunto({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setAviso('No se pudo obtener la ubicación. Toque el mapa en su zona.'),
      { enableHighAccuracy: false, timeout: 10000 },
    );
  }

  if (actual.isPending) return <Cargando />;
  if (actual.isError) return <Aviso tipo="error">{mensajeError(actual.error)}</Aviso>;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(ev) => {
        ev.preventDefault();
        setGuardado(false);
        if (nombre.trim().length >= 2) guardar.mutate();
      }}
    >
      <Campo
        id="pp-empresa"
        etiqueta="Nombre de la empresa"
        value={nombre}
        onChange={(ev) => setNombre(ev.target.value)}
        ayuda="Aparece en el menú y en los documentos."
      />
      <div>
        <p className="mb-1 font-medium">Centro de su zona de operación</p>
        <p className="mb-2 text-sm text-tenue">
          Mueva el mapa hasta su comuna y toque el centro de la zona donde tiene red. El mapa de la red abrirá ahí.
        </p>
        <MiniMapa valor={punto} centro={actual.data.centro} alCambiar={setPunto} alto={320} />
        <button type="button" onClick={ubicarme} className="mt-2 text-sm font-medium text-acento hover:underline">
          Usar mi ubicación actual
        </button>
        {aviso && <p className="mt-1 text-sm text-tenue">{aviso}</p>}
      </div>
      {guardar.isError && <Aviso tipo="error">{mensajeError(guardar.error)}</Aviso>}
      {guardado && !guardar.isPending && <Aviso tipo="exito">Datos de la empresa guardados.</Aviso>}
      <div>
        <Boton type="submit" cargando={guardar.isPending} disabled={nombre.trim().length < 2}>
          Guardar
        </Boton>
      </div>
    </form>
  );
}
