import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { supabase } from '../lib/supabase';
import { mensajeError } from '../lib/errores';
import { Aviso, Boton, Campo } from '../components/ui';
import { PaginaAcceso } from './PaginaAcceso';

export function RecuperarClave() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/establecer-clave`,
    });
    setEnviando(false);
    if (error) {
      setError(mensajeError(error));
      return;
    }
    setEnviado(true);
  }

  return (
    <PaginaAcceso
      titulo="Recuperar contraseña"
      detalle="Le enviaremos un enlace para crear una contraseña nueva."
    >
      {enviado ? (
        <div className="flex flex-col gap-4">
          <Aviso tipo="exito">
            Si el correo pertenece a un usuario de la plataforma, recibirá el enlace en unos minutos. Revise también
            la carpeta de spam.
          </Aviso>
          <Link to="/ingresar" className="text-sm text-acento hover:underline">
            Volver a ingresar
          </Link>
        </div>
      ) : (
        <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
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
          <Boton type="submit" cargando={enviando} disabled={!email}>
            Enviar enlace
          </Boton>
          <Link to="/ingresar" className="text-sm text-acento hover:underline">
            Volver a ingresar
          </Link>
        </form>
      )}
    </PaginaAcceso>
  );
}
