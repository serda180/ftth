import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { supabase } from '../lib/supabase';
import { mensajeError } from '../lib/errores';
import { useAuth } from '../auth/AuthProvider';
import { Aviso, Boton, Campo, PantallaCarga } from '../components/ui';
import { PaginaAcceso } from './PaginaAcceso';

/** Destino de los enlaces de invitación y de recuperación de contraseña. */
export function EstablecerClave() {
  const { cargando, session, marcarClaveCambiada } = useAuth();
  const navegar = useNavigate();
  const [clave, setClave] = useState('');
  const [repetir, setRepetir] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  if (cargando) return <PantallaCarga />;

  if (!session) {
    return (
      <PaginaAcceso titulo="Enlace no válido" detalle="El enlace venció o ya fue usado.">
        <div className="flex flex-col gap-3">
          <p className="text-tenue">Pida un enlace nuevo o solicite a un administrador que le reenvíe la invitación.</p>
          <Link to="/recuperar-clave" className="text-sm text-acento hover:underline">
            Pedir un enlace nuevo
          </Link>
        </div>
      </PaginaAcceso>
    );
  }

  const errorLargo = clave && clave.length < 8 ? 'Use al menos 8 caracteres.' : '';
  const errorRepetir = repetir && repetir !== clave ? 'Las contraseñas no coinciden.' : '';

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (clave.length < 8 || clave !== repetir) return;
    setError('');
    setEnviando(true);
    const { error } = await supabase.auth.updateUser({ password: clave });
    setEnviando(false);
    if (error) {
      setError(mensajeError(error));
      return;
    }
    marcarClaveCambiada();
    navegar('/', { replace: true });
  }

  return (
    <PaginaAcceso titulo="Crear contraseña" detalle={`Para ${session.user.email}`}>
      <form onSubmit={guardar} className="flex flex-col gap-4" noValidate>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <Campo
          id="clave"
          etiqueta="Contraseña nueva"
          type="password"
          autoComplete="new-password"
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          error={errorLargo}
          ayuda="Al menos 8 caracteres."
        />
        <Campo
          id="repetir"
          etiqueta="Repita la contraseña"
          type="password"
          autoComplete="new-password"
          value={repetir}
          onChange={(e) => setRepetir(e.target.value)}
          error={errorRepetir}
        />
        <Boton type="submit" cargando={enviando} disabled={clave.length < 8 || clave !== repetir}>
          Guardar contraseña
        </Boton>
      </form>
    </PaginaAcceso>
  );
}
