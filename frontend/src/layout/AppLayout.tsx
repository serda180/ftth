import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Gauge, ClipboardList, Inbox, Wrench, Map as IconoMapa, Network, Contact, Settings, Users, UserCircle, LogOut, Menu, X, type LucideIcon } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { ROLES_PANEL, nombreRol, tieneRol, type Rol } from '../lib/roles';
import { supabase } from '../lib/supabase';
import { CintaFibra } from '../components/CintaFibra';

type ItemMenu = { a: string; texto: string; icono: LucideIcon; roles: Rol[] | 'todos' };

// Solo aparecen módulos que ya funcionan; los de etapas siguientes se
// agregan aquí a medida que se implementan.
const MENU: ItemMenu[] = [
  { a: '/', texto: 'Panel', icono: Gauge, roles: ROLES_PANEL },
  { a: '/mapa', texto: 'Mapa de la red', icono: IconoMapa, roles: 'todos' },
  { a: '/solicitudes', texto: 'Solicitudes', icono: Inbox, roles: ['supervisor_red', 'atencion_cliente'] },
  { a: '/ordenes', texto: 'Órdenes de trabajo', icono: Wrench, roles: ['supervisor_red', 'atencion_cliente'] },
  { a: '/clientes', texto: 'Clientes', icono: Contact, roles: ['supervisor_red', 'atencion_cliente'] },
  { a: '/topologia', texto: 'Topología', icono: Network, roles: 'todos' },
  { a: '/mis-ordenes', texto: 'Mis órdenes', icono: ClipboardList, roles: ['tecnico'] },
  { a: '/usuarios', texto: 'Usuarios', icono: Users, roles: ['administrador'] },
  { a: '/configuracion', texto: 'Configuración', icono: Settings, roles: ['administrador'] },
  { a: '/mi-cuenta', texto: 'Mi cuenta', icono: UserCircle, roles: 'todos' },
];

export function useNombreEmpresa(): string {
  const { session } = useAuth();
  const { data } = useQuery({
    queryKey: ['configuracion', 'nombre_empresa'],
    enabled: session != null, // la configuración solo es legible con sesión
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('configuracion').select('valor').eq('clave', 'nombre_empresa').maybeSingle();
      if (error) throw error;
      return (data?.valor as string | null) ?? '';
    },
    staleTime: 10 * 60 * 1000,
  });
  return data?.trim() || 'Gestión FTTH';
}

export function AppLayout() {
  const { perfil, roles, cerrarSesion } = useAuth();
  const empresa = useNombreEmpresa();
  const [abierto, setAbierto] = useState(false);
  const ubicacion = useLocation();

  useEffect(() => setAbierto(false), [ubicacion.pathname]);
  const pantallaCompleta = ubicacion.pathname.startsWith('/mapa');

  const items = MENU.filter((i) => i.roles === 'todos' || tieneRol(roles, ...i.roles));

  const menu = (
    <nav className="flex h-full flex-col bg-chaqueta text-white/85">
      <div className="flex items-stretch gap-3 px-5 pb-6 pt-6">
        <CintaFibra sentido="vertical" grosor={3} separacion={1.5} className="h-11" />
        <div className="flex flex-col justify-center">
          <span className="font-cond text-lg font-semibold leading-tight text-white">{empresa}</span>
          <span className="text-[13px] text-white/55">Red de fibra óptica</span>
        </div>
      </div>

      <ul className="flex flex-1 flex-col gap-0.5 px-3">
        {items.map(({ a, texto, icono: Icono }) => (
          <li key={a}>
            <NavLink
              to={a}
              end={a === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2.5 text-[15px] font-medium transition-colors
                 ${isActive ? 'bg-white/10 text-white shadow-[inset_3px_0_0_var(--color-f-naranjo)]' : 'hover:bg-chaqueta-2 hover:text-white'}`
              }
            >
              <Icono className="size-[18px] shrink-0" aria-hidden />
              {texto}
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="border-t border-white/10 px-5 py-4">
        <p className="truncate text-sm font-medium text-white">{perfil?.nombre_completo || perfil?.email}</p>
        <p className="truncate text-[13px] text-white/55">{roles.map(nombreRol).join(', ')}</p>
        <button
          type="button"
          onClick={() => void cerrarSesion()}
          className="mt-3 inline-flex items-center gap-2 text-sm text-white/70 hover:text-white"
        >
          <LogOut className="size-4" aria-hidden />
          Cerrar sesión
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      {/* Menú fijo en escritorio */}
      <aside className="sticky top-0 hidden h-dvh lg:block">{menu}</aside>

      {/* Barra superior y menú desplegable en móvil y tablet */}
      <div className="sticky top-0 z-30 flex items-center gap-3 bg-chaqueta px-4 py-3 text-white lg:hidden">
        <button
          type="button"
          onClick={() => setAbierto(true)}
          aria-label="Abrir menú"
          aria-expanded={abierto}
          className="-ml-1 rounded p-1 hover:bg-white/10"
        >
          <Menu className="size-6" aria-hidden />
        </button>
        <CintaFibra sentido="vertical" grosor={2} separacion={1} className="h-6" />
        <span className="font-cond text-lg font-semibold">{empresa}</span>
      </div>
      {abierto && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Cerrar menú"
            onClick={() => setAbierto(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[272px] max-w-[85vw]">
            <button
              type="button"
              onClick={() => setAbierto(false)}
              aria-label="Cerrar menú"
              className="absolute right-3 top-3 z-10 rounded p-1 text-white/80 hover:bg-white/10"
            >
              <X className="size-5" aria-hidden />
            </button>
            {menu}
          </div>
        </div>
      )}

      {pantallaCompleta ? (
        // El mapa usa todo el alto disponible, sin márgenes.
        <main className="h-[calc(100dvh-52px)] w-full lg:h-dvh">
          <Outlet />
        </main>
      ) : (
        <main className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
          <Outlet />
        </main>
      )}
    </div>
  );
}
