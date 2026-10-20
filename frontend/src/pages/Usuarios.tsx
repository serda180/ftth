import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { llamarFuncion } from '../lib/funciones';
import { mensajeError } from '../lib/errores';
import { ROLES, type Rol } from '../lib/roles';
import { formatearFecha } from '../lib/formato';
import { useAuth } from '../auth/AuthProvider';
import { Aviso, Boton, Campo, Cargando, EncabezadoPagina } from '../components/ui';

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
          alInvitar={async (email) => {
            setInvitando(false);
            setAviso({ tipo: 'exito', texto: `Invitación enviada a ${email}.` });
            await qc.invalidateQueries({ queryKey: ['usuarios'] });
          }}
        />
      )}

      {aviso && (
        <div className="mb-4">
          <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>
        </div>
      )}

      {consulta.isPending && <Cargando />}
      {consulta.isError && <Aviso tipo="error">{mensajeError(consulta.error)}</Aviso>}

      {consulta.data && (
        <div className="overflow-x-auto rounded-md border border-linea bg-superficie">
          <table className="w-full min-w-[760px] text-left">
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

function FormularioInvitacion({ alCerrar, alInvitar }: { alCerrar: () => void; alInvitar: (email: string) => void }) {
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
      await llamarFuncion('admin-usuarios', {
        accion: 'invitar',
        email: email.trim().toLowerCase(),
        nombre_completo: nombre.trim(),
        roles,
      });
      alInvitar(email.trim());
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
          ayuda="Recibirá un enlace para crear su contraseña."
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
            Enviar invitación
          </Boton>
          <Boton type="button" variante="secundario" onClick={alCerrar}>
            Cancelar
          </Boton>
        </div>
      </form>
    </section>
  );
}
