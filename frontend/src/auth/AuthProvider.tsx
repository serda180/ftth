import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Rol } from '../lib/roles';

export type Perfil = {
  id: string;
  email: string;
  nombre_completo: string;
  telefono: string | null;
  activo: boolean;
};

type EstadoAuth = {
  cargando: boolean;
  session: Session | null;
  perfil: Perfil | null;
  roles: Rol[];
  /** Verdadero tras abrir un enlace de recuperación: hay que fijar una contraseña nueva. */
  debeCambiarClave: boolean;
  recargarPerfil: () => Promise<void>;
  marcarClaveCambiada: () => void;
  cerrarSesion: () => Promise<void>;
};

const AuthContext = createContext<EstadoAuth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [roles, setRoles] = useState<Rol[]>([]);
  const [cargandoSesion, setCargandoSesion] = useState(true);
  const [perfilCargadoPara, setPerfilCargadoPara] = useState<string | null>(null);
  const [debeCambiarClave, setDebeCambiarClave] = useState(false);

  const userId = session?.user.id ?? null;

  const cargarPerfil = useCallback(async (id: string) => {
    try {
      const [p, r] = await Promise.all([
        supabase.from('perfiles').select('id, email, nombre_completo, telefono, activo').eq('id', id).maybeSingle(),
        supabase.rpc('mis_roles'),
      ]);
      setPerfil((p.data as Perfil | null) ?? null);
      setRoles(((r.data as Rol[] | null) ?? []).slice());
    } finally {
      setPerfilCargadoPara(id);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCargandoSesion(false);
    });
    const { data } = supabase.auth.onAuthStateChange((evento, nueva) => {
      setSession(nueva);
      if (evento === 'PASSWORD_RECOVERY') setDebeCambiarClave(true);
      if (evento === 'SIGNED_OUT') {
        setPerfil(null);
        setRoles([]);
        setDebeCambiarClave(false);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (userId) void cargarPerfil(userId);
  }, [userId, cargarPerfil]);

  const valor = useMemo<EstadoAuth>(
    () => ({
      cargando: cargandoSesion || (userId != null && perfilCargadoPara !== userId),
      session,
      perfil,
      roles,
      debeCambiarClave,
      recargarPerfil: async () => {
        if (userId) await cargarPerfil(userId);
      },
      marcarClaveCambiada: () => setDebeCambiarClave(false),
      cerrarSesion: async () => {
        await supabase.auth.signOut();
      },
    }),
    [cargandoSesion, perfilCargadoPara, session, perfil, roles, debeCambiarClave, userId, cargarPerfil],
  );

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

export function useAuth(): EstadoAuth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
