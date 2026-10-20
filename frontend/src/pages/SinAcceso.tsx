import { Link } from 'react-router';
import { ShieldX } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { Boton } from '../components/ui';

export function SinAcceso({
  titulo,
  detalle,
  conCerrarSesion = false,
}: {
  titulo: string;
  detalle: string;
  conCerrarSesion?: boolean;
}) {
  const { cerrarSesion } = useAuth();
  return (
    <div className={`flex flex-col items-start gap-3 ${conCerrarSesion ? 'mx-auto max-w-md px-5 py-24' : 'py-10'}`}>
      <ShieldX className="size-8 text-tenue" aria-hidden />
      <h1 className="font-cond text-2xl font-semibold">{titulo}</h1>
      <p className="text-tenue">{detalle}</p>
      {conCerrarSesion ? (
        <Boton variante="secundario" onClick={() => void cerrarSesion()}>
          Cerrar sesión
        </Boton>
      ) : (
        <Link to="/" className="text-acento hover:underline">
          Ir al inicio
        </Link>
      )}
    </div>
  );
}

export function NoEncontrado() {
  return (
    <SinAcceso titulo="Esta página no existe" detalle="Revise la dirección o vuelva al inicio." />
  );
}
