import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { supabase } from '../lib/supabase';
import { mensajeError } from '../lib/errores';
import { useAuth } from '../auth/AuthProvider';
import { Aviso, Boton, Campo } from '../components/ui';
import { PaginaAcceso } from './PaginaAcceso';

export function Ingresar() {
  const { session } = useAuth();
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const destino = (ubicacion.state as { desde?: string } | null)?.desde ?? '/';

  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  if (session) return <Navigate to={destino} replace />;

  async function ingresar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: clave });
    setEnviando(false);
    if (error) {
      setError(mensajeError(error));
      return;
    }
    navegar(destino, { replace: true });
  }

  return (
    <PaginaAcceso titulo="Ingresar" detalle="Use el correo con el que fue invitado a la plataforma.">
      <form onSubmit={ingresar} className="flex flex-col gap-4" noValidate>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <Campo
          id="email"
          etiqueta="Correo"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Campo
          id="clave"
          etiqueta="Contraseña"
          type="password"
          autoComplete="current-password"
          required
          value={clave}
          onChange={(e) => setClave(e.target.value)}
        />
        <Boton type="submit" cargando={enviando} disabled={!email || !clave} className="mt-2">
          Ingresar
        </Boton>
        <Link to="/recuperar-clave" className="text-sm text-acento hover:underline">
          Olvidé mi contraseña
        </Link>
      </form>
    </PaginaAcceso>
  );
}
