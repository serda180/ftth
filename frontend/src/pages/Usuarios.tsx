import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, MessageCircle, UserPlus, X } from 'lucide-react';
import { correoConfigurado, supabase } from '../lib/supabase';
import { llamarFuncion } from '../lib/funciones';
import { mensajeError } from '../lib/errores';
import { ROLES, type Rol } from '../lib/roles';
import { formatearFecha } from '../lib/formato';
import { useAuth } from '../auth/AuthProvider';
import { Aviso, Boton, Campo, Cargando, EncabezadoPagina } from '../components/ui';

type EnlaceGenerado = { para: string; enlace: string; tipo: 'invitacion' | 'acceso'; correoEnviado: boolean };

type Usuario = {
  id: string;
  email: string;
  nombre_completo: string;
  activo: boolean;
  creado_en: string;
  usuario_roles: { rol: Rol }[];
};

export function Usuarios() {
  const { session, recargarPerfil } = useAuth();
  const qc = useQueryClient();
  const [invitando, setInvitando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'error' | 'exito'; texto: string } | null>(null);
  const [enlace, setEnlace] = useState<EnlaceGenerado | null>(null);

  const consulta = useQuery({
    queryKey: ['usuarios'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('perfiles')
        .select('id, email, nombre_completo, activo, creado_en, usuario_roles!usuario_roles_usuario_id_fkey(rol)')
        .order('activo', { ascending: false })
        .order('nombre_completo');
      if (error) throw error;
      return (data ?? []) as unknown as Usuario[];
    },
  });

  const refrescar = async (usuarioId: string) => {
    await qc.invalidateQueries({ queryKey: ['usuarios'] });
    if (usuarioId === session?.user.id) await recargarPerfil();
  };

  const cambiarRol = useMutation({
    mutationFn: async ({ usuario, rol, asignar }: { usuario: string; rol: Rol; asignar: boolean }) => {
      const { error } = asignar
        ? await supabase.from('usuario_roles').insert({ usuario_id: usuario, rol, asignado_por: session?.user.id })
        : await supabase.from('usuario_roles').delete().eq('usuario_id', usuario).eq('rol', rol);
      if (error) throw error;
    },
    onMutate: () => setAviso(null),
    onError: (e) => setAviso({ tipo: 'error', texto: mensajeError(e) }),
    onSettled: (_d, _e, v) => refrescar(v.usuario),
  });

  const cambiarEstado = useMutation({
    mutationFn: async ({ usuario, activar }: { usuario: string; activar: boolean }) =>
      llamarFuncion('admin-usuarios', { accion: activar ? 'reactivar' : 'desactivar', usuario_id: usuario }),
    onMutate: () => setAviso(null),
    onSuccess: (_d, v) => setAviso({ tipo: 'exito', texto: v.activar ? 'Usuario reactivado.' : 'Usuario desactivado.' }),
    onError: (e) => setAviso({ tipo: 'error', texto: mensajeError(e) }),
    onSettled: (_d, _e, v) => refrescar(v.usuario),
  });

  const pedirEnlace = useMutation({
    mutationFn: async (u: Usuario) =>
      llamarFuncion<{ enlace: string }>('admin-usuarios', { accion: 'enlace', usuario_id: u.id }),
    onMutate: () => {
      setAviso(null);
      setEnlace(null);
    },
    onSuccess: (r, u) =>
      setEnlace({ para: u.nombre_completo || u.email, enlace: r.enlace, tipo: 'acceso', correoEnviado: false }),
    onError: (e) => setAviso({ tipo: 'error', texto: mensajeError(e) }),
  });

  return (
    <>
      <EncabezadoPagina
        titulo="Usuarios"
        detalle="Invite personas a la plataforma y defina qué puede hacer cada una. Un usuario puede tener varios roles."
        acciones={
          !invitando && (
            <Boton onClick={() => setInvitando(true)}>
              <UserPlus className="size-4" aria-hidden /> Invitar usuario
            </Boton>
          )
        }
      />

      {invitando && (
        <FormularioInvitacion
          alCerrar={() => setInvitando(false)}
          alInvitar={async (generado) => {
            setInvitando(false);
            setAviso(null);
            setEnlace(generado);
            await qc.invalidateQueries({ queryKey: ['usuarios'] });
          }}
        />
      )}

      {enlace && <PanelEnlace enlace={enlace} alCerrar={() => setEnlace(null)} />}

      {aviso && (
        <div className="mb-4">
          <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>
        </div>
      )}

      {consulta.isPending && <Cargando />}
      {consulta.isError && <Aviso tipo="error">{mensajeError(consulta.error)}</Aviso>}

      {consulta.data && (
        <div className="overflow-x-auto rounded-md border border-linea bg-superficie">
          <table className="w-full min-w-[900px] text-left">
            <thead className="border-b border-linea text-sm text-tenue">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Persona</th>
                {ROLES.map((r) => (
                  <th key={r.valor} scope="col" className="px-2 py-3 text-center font-medium" title={r.descripcion}>
                    {r.nombre}
                  </th>
                ))}
                <th scope="col" className="px-4 py-3 font-medium">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {consulta.data.map((u) => {
                const propios = u.usuario_roles.map((r) => r.rol);
                const soyYo = u.id === session?.user.id;
                return (
                  <tr key={u.id} className={`border-b border-linea last:border-0 ${u.activo ? '' : 'text-tenue'}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium">
                        {u.nombre_completo || 'Sin nombre'}
                        {soyYo && <span className="ml-2 text-sm font-normal text-tenue">(usted)</span>}
                      </p>
                      <p className="text-sm text-tenue">{u.email}</p>
                      <p className="text-xs text-tenue">
                        {u.activo ? `Desde ${formatearFecha(u.creado_en)}` : 'Desactivado'}
                      </p>
                    </td>
                    {ROLES.map((r) => {
                      const marcado = propios.includes(r.valor);
                      return (
                        <td key={r.valor} className="px-2 py-3 text-center">
                          <input
                            type="checkbox"
                            className="size-5 accent-[var(--color-acento)]"
                            checked={marcado}
                            disabled={!u.activo || cambiarRol.isPending}
                            aria-label={`${r.nombre} para ${u.nombre_completo || u.email}`}
                            onChange={() => cambiarRol.mutate({ usuario: u.id, rol: r.valor, asignar: !marcado })}
                          />
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                      {!soyYo && u.activo && (
                        <Boton
                          variante="secundario"
                          className="whitespace-nowrap px-3 py-1.5 text-sm"
                          title="Enlace para crear una contraseña nueva (si la olvidó o no recibió la invitación)"
                          cargando={pedirEnlace.isPending && pedirEnlace.variables?.id === u.id}
                          onClick={() => pedirEnlace.mutate(u)}
                        >
                          <KeyRound className="size-4" aria-hidden /> Enlace de acceso
                        </Boton>
                      )}
                      {!soyYo && (
                        <Boton
                          variante={u.activo ? 'peligro' : 'secundario'}
                          className="whitespace-nowrap px-3 py-1.5 text-sm"
                          cargando={cambiarEstado.isPending && cambiarEstado.variables?.usuario === u.id}
                          onClick={() => {
                            const accion = u.activo ? 'desactivar' : 'reactivar';
                            if (window.confirm(`¿Seguro que quiere ${accion} a ${u.nombre_completo || u.email}?`)) {
                              cambiarEstado.mutate({ usuario: u.id, activar: !u.activo });
                            }
                          }}
                        >
                          {u.activo ? 'Desactivar' : 'Reactivar'}
                        </Boton>
                      )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-sm text-tenue">
        Al asignar el rol de técnico se crea automáticamente su bodega para el control de materiales.
      </p>
    </>
  );
}

function FormularioInvitacion({
  alCerrar,
  alInvitar,
}: {
  alCerrar: () => void;
  alInvitar: (generado: EnlaceGenerado) => void;
}) {
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [roles, setRoles] = useState<Rol[]>([]);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const emailValido = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!emailValido || nombre.trim().length < 2 || roles.length === 0) return;
    setError('');
    setEnviando(true);
    try {
      const r = await llamarFuncion<{ enlace: string; correo_enviado: boolean }>('admin-usuarios', {
        accion: 'invitar',
        email: email.trim().toLowerCase(),
        nombre_completo: nombre.trim(),
        roles,
      });
      alInvitar({ para: nombre.trim(), enlace: r.enlace, tipo: 'invitacion', correoEnviado: r.correo_enviado });
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="mb-6 rounded-md border border-linea bg-superficie p-5" aria-labelledby="titulo-invitar">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="titulo-invitar" className="font-cond text-xl font-semibold">
          Invitar usuario
        </h2>
        <button type="button" onClick={alCerrar} aria-label="Cerrar" className="rounded p-1 text-tenue hover:bg-fondo">
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <form onSubmit={enviar} className="grid gap-4 md:grid-cols-2" noValidate>
        <Campo
          id="inv-nombre"
          etiqueta="Nombre completo"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          autoComplete="off"
        />
        <Campo
          id="inv-email"
          etiqueta="Correo"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={email && !emailValido ? 'Revise el formato del correo.' : undefined}
          ayuda={
            correoConfigurado
              ? 'Recibirá un enlace por correo para crear su contraseña.'
              : 'Es su usuario para ingresar. El enlace para crear la contraseña se lo comparte usted.'
          }
          autoComplete="off"
        />
        <fieldset className="md:col-span-2">
          <legend className="mb-2 text-sm font-medium">Roles</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ROLES.map((r) => (
              <label
                key={r.valor}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-linea px-3 py-2 has-[:checked]:border-acento"
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-[var(--color-acento)]"
                  checked={roles.includes(r.valor)}
                  onChange={(e) =>
                    setRoles((prev) => (e.target.checked ? [...prev, r.valor] : prev.filter((x) => x !== r.valor)))
                  }
                />
                <span>
                  <span className="block font-medium">{r.nombre}</span>
                  <span className="block text-sm text-tenue">{r.descripcion}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <div className="md:col-span-2">
            <Aviso tipo="error">{error}</Aviso>
          </div>
        )}
        <div className="flex gap-3 md:col-span-2">
          <Boton
            type="submit"
            cargando={enviando}
            disabled={!emailValido || nombre.trim().length < 2 || roles.length === 0}
          >
            {correoConfigurado ? 'Enviar invitación' : 'Crear invitación'}
          </Boton>
          <Boton type="button" variante="secundario" onClick={alCerrar}>
            Cancelar
          </Boton>
        </div>
      </form>
    </section>
  );
}

/** Enlace de invitación o de acceso, para copiar o compartir por WhatsApp. */
function PanelEnlace({ enlace, alCerrar }: { enlace: EnlaceGenerado; alCerrar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const vigencia = enlace.tipo === 'invitacion' ? '7 días' : '3 días';
  const mensaje =
    enlace.tipo === 'invitacion'
      ? `Hola ${enlace.para}, te invito a la Plataforma FTTH. Abre este enlace para crear tu contraseña (vale ${vigencia}): ${enlace.enlace}`
      : `Hola ${enlace.para}, con este enlace puedes crear una contraseña nueva en la Plataforma FTTH (vale ${vigencia}): ${enlace.enlace}`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(enlace.enlace);
    } catch {
      const campo = document.getElementById('enlace-generado') as HTMLInputElement | null;
      campo?.select();
      document.execCommand('copy');
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <section className="mb-6 rounded-md border border-acento bg-superficie p-5" aria-labelledby="titulo-enlace">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 id="titulo-enlace" className="font-cond text-xl font-semibold">
            {enlace.tipo === 'invitacion' ? 'Invitación creada' : 'Enlace de acceso'}
          </h2>
          <p className="text-sm text-tenue">
            {enlace.correoEnviado
              ? `Se envió por correo a ${enlace.para}. También puede compartir el enlace.`
              : `Envíe este enlace a ${enlace.para}. Sirve una sola vez y vale ${vigencia}.`}
          </p>
        </div>
        <button type="button" onClick={alCerrar} aria-label="Cerrar" className="rounded p-1 text-tenue hover:bg-fondo">
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="enlace-generado"
          readOnly
          value={enlace.enlace}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-linea bg-fondo px-3 py-2 font-mono text-sm"
          aria-label="Enlace"
        />
        <Boton type="button" variante="secundario" onClick={copiar}>
          <Copy className="size-4" aria-hidden /> {copiado ? 'Copiado' : 'Copiar'}
        </Boton>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-md border border-linea px-4 py-2 font-medium hover:bg-fondo"
        >
          <MessageCircle className="size-4" aria-hidden /> WhatsApp
        </a>
      </div>
      <p className="mt-3 text-xs text-tenue">
        La persona debe estar en la red de la oficina y tener instalado el certificado de la oficina en su equipo.
      </p>
    </section>
  );
}
