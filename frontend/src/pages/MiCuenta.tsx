import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { mensajeError } from '../lib/errores';
import { nombreRol } from '../lib/roles';
import { formatearTelefono } from '../lib/formato';
import { useAuth } from '../auth/AuthProvider';
import { Aviso, Boton, Campo, EncabezadoPagina } from '../components/ui';

export function MiCuenta() {
  const { perfil, roles, recargarPerfil } = useAuth();
  const [nombre, setNombre] = useState(perfil?.nombre_completo ?? '');
  const [telefono, setTelefono] = useState(perfil?.telefono ? formatearTelefono(perfil.telefono) : '');
  const [avisoDatos, setAvisoDatos] = useState<{ tipo: 'error' | 'exito'; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [clave, setClave] = useState('');
  const [avisoClave, setAvisoClave] = useState<{ tipo: 'error' | 'exito'; texto: string } | null>(null);
  const [cambiando, setCambiando] = useState(false);

  if (!perfil) return null;

  async function guardarDatos(e: FormEvent) {
    e.preventDefault();
    setAvisoDatos(null);
    setGuardando(true);
    const { error } = await supabase
      .from('perfiles')
      .update({ nombre_completo: nombre.trim(), telefono: telefono.trim() || null })
      .eq('id', perfil!.id);
    setGuardando(false);
    if (error) {
      setAvisoDatos({
        tipo: 'error',
        texto: error.code === '23514' ? 'El teléfono debe ser chileno, por ejemplo +56 9 1234 5678.' : mensajeError(error),
      });
      return;
    }
    await recargarPerfil();
    setAvisoDatos({ tipo: 'exito', texto: 'Datos guardados.' });
  }

  async function cambiarClave(e: FormEvent) {
    e.preventDefault();
    if (clave.length < 8) return;
    setAvisoClave(null);
    setCambiando(true);
    const { error } = await supabase.auth.updateUser({ password: clave });
    setCambiando(false);
    if (error) {
      setAvisoClave({ tipo: 'error', texto: mensajeError(error) });
      return;
    }
    setClave('');
    setAvisoClave({ tipo: 'exito', texto: 'Contraseña cambiada.' });
  }

  return (
    <>
      <EncabezadoPagina titulo="Mi cuenta" detalle={`${perfil.email} · ${roles.map(nombreRol).join(', ')}`} />
      <div className="grid max-w-3xl gap-10 md:grid-cols-2">
        <form onSubmit={guardarDatos} className="flex flex-col gap-4" noValidate>
          <h2 className="font-cond text-xl font-semibold">Datos personales</h2>
          <Campo id="nombre" etiqueta="Nombre completo" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <Campo
            id="telefono"
            etiqueta="Teléfono"
            type="tel"
            inputMode="tel"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            ayuda="Ejemplo: +56 9 1234 5678"
          />
          {avisoDatos && <Aviso tipo={avisoDatos.tipo}>{avisoDatos.texto}</Aviso>}
          <Boton type="submit" cargando={guardando} disabled={nombre.trim().length < 2} className="self-start">
            Guardar datos
          </Boton>
        </form>

        <form onSubmit={cambiarClave} className="flex flex-col gap-4" noValidate>
          <h2 className="font-cond text-xl font-semibold">Contraseña</h2>
          <Campo
            id="clave-nueva"
            etiqueta="Contraseña nueva"
            type="password"
            autoComplete="new-password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            error={clave && clave.length < 8 ? 'Use al menos 8 caracteres.' : undefined}
          />
          {avisoClave && <Aviso tipo={avisoClave.tipo}>{avisoClave.texto}</Aviso>}
          <Boton type="submit" cargando={cambiando} disabled={clave.length < 8} className="self-start">
            Cambiar contraseña
          </Boton>
        </form>
      </div>
    </>
  );
}
