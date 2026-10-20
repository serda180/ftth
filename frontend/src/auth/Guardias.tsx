import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from './AuthProvider';
import { tieneRol, type Rol } from '../lib/roles';
import { PantallaCarga } from '../components/ui';
import { SinAcceso } from '../pages/SinAcceso';

/** Exige sesión iniciada, perfil activo y al menos un rol. */
export function RequiereSesion({ children }: { children: ReactNode }) {
  const { cargando, session, perfil, roles, debeCambiarClave } = useAuth();
  const ubicacion = useLocation();

  if (cargando) return <PantallaCarga />;
  if (!session) return <Navigate to="/ingresar" replace state={{ desde: ubicacion.pathname }} />;
  if (debeCambiarClave) return <Navigate to="/establecer-clave" replace />;
  if (!perfil || !perfil.activo || roles.length === 0) {
    return (
      <SinAcceso
        titulo="Su cuenta no está habilitada"
        detalle="Su usuario no tiene roles asignados o fue desactivado. Pida a un administrador que revise su cuenta."
        conCerrarSesion
      />
    );
  }
  return <>{children}</>;
}

/** Exige alguno de los roles indicados (el administrador siempre cumple). */
export function RequiereRol({ roles: requeridos, children }: { roles: Rol[]; children: ReactNode }) {
  const { roles } = useAuth();
  if (!tieneRol(roles, ...requeridos)) {
    return <SinAcceso titulo="No tiene acceso a esta sección" detalle="Su rol no incluye este módulo." />;
  }
  return <>{children}</>;
}
