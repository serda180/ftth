import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { RequiereRol, RequiereSesion } from './auth/Guardias';
import { AppLayout } from './layout/AppLayout';
import { configuracionFaltante } from './lib/supabase';
import { ROLES_PANEL, tieneRol } from './lib/roles';
import { Ingresar } from './pages/Ingresar';
import { RecuperarClave } from './pages/RecuperarClave';
import { EstablecerClave } from './pages/EstablecerClave';
import { Panel } from './pages/Panel';
import { MisOrdenes } from './pages/MisOrdenes';
import { Usuarios } from './pages/Usuarios';
import { MiCuenta } from './pages/MiCuenta';
import { PaginaMapa } from './mapa/PaginaMapa';
import { ListaClientes } from './clientes/ListaClientes';
import { FormCliente } from './clientes/FormCliente';
import { FichaCliente } from './clientes/FichaCliente';
import { PaginaTopologia } from './topologia/PaginaTopologia';
import { Configuracion } from './pages/Configuracion';
import { ListaSolicitudes } from './solicitudes/ListaSolicitudes';
import { FormSolicitud } from './solicitudes/FormSolicitud';
import { FichaSolicitud } from './solicitudes/FichaSolicitud';
import { ListaOrdenes } from './ordenes/ListaOrdenes';
import { FormOrden } from './ordenes/FormOrden';
import { FichaOrden } from './ordenes/FichaOrden';
import { TecnicoOrden } from './ordenes/TecnicoOrden';
import { NoEncontrado } from './pages/SinAcceso';

const clienteQuery = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true } },
});

/** Inicio según el rol: panel para gestión, "Mis órdenes" para técnicos. */
function Inicio() {
  const { roles } = useAuth();
  if (tieneRol(roles, ...ROLES_PANEL)) return <Panel />;
  if (roles.includes('tecnico')) return <Navigate to="/mis-ordenes" replace />;
  return <Navigate to="/mi-cuenta" replace />;
}

export function App() {
  if (configuracionFaltante) {
    return (
      <div className="mx-auto max-w-xl px-5 py-20">
        <h1 className="font-cond text-2xl font-semibold">Falta configurar la conexión</h1>
        <p className="mt-2 text-tenue">
          Defina SUPABASE_URL y SUPABASE_ANON_KEY en el contenedor (o VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en
          frontend/.env para desarrollo) y recargue la página.
        </p>
      </div>
    );
  }

  return (
    <QueryClientProvider client={clienteQuery}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/ingresar" element={<Ingresar />} />
            <Route path="/recuperar-clave" element={<RecuperarClave />} />
            <Route path="/establecer-clave" element={<EstablecerClave />} />
            <Route
              element={
                <RequiereSesion>
                  <AppLayout />
                </RequiereSesion>
              }
            >
              <Route index element={<Inicio />} />
              <Route
                path="mis-ordenes"
                element={
                  <RequiereRol roles={['tecnico']}>
                    <MisOrdenes />
                  </RequiereRol>
                }
              />
              <Route
                path="usuarios"
                element={
                  <RequiereRol roles={['administrador']}>
                    <Usuarios />
                  </RequiereRol>
                }
              />
              <Route path="mapa" element={<PaginaMapa />} />
              <Route path="topologia" element={<PaginaTopologia />} />
              <Route
                path="clientes"
                element={
                  <RequiereRol roles={['supervisor_red', 'atencion_cliente']}>
                    <ListaClientes />
                  </RequiereRol>
                }
              />
              <Route
                path="clientes/nuevo"
                element={
                  <RequiereRol roles={['atencion_cliente']}>
                    <FormCliente />
                  </RequiereRol>
                }
              />
              {/* La ficha la ven también los técnicos con una orden de ese cliente (lo decide la base). */}
              <Route path="clientes/:id" element={<FichaCliente />} />
              <Route
                path="clientes/:id/editar"
                element={
                  <RequiereRol roles={['atencion_cliente']}>
                    <FormCliente />
                  </RequiereRol>
                }
              />
              {(
                [
                  ['solicitudes', <ListaSolicitudes />],
                  ['solicitudes/nueva', <FormSolicitud />],
                  ['solicitudes/:id', <FichaSolicitud />],
                  ['solicitudes/:id/editar', <FormSolicitud />],
                  ['ordenes', <ListaOrdenes />],
                  ['ordenes/nueva', <FormOrden />],
                  ['ordenes/:id', <FichaOrden />],
                ] as const
              ).map(([ruta, pagina]) => (
                <Route key={ruta} path={ruta} element={<RequiereRol roles={['supervisor_red', 'atencion_cliente']}>{pagina}</RequiereRol>} />
              ))}
              <Route
                path="mis-ordenes/:id"
                element={
                  <RequiereRol roles={['tecnico']}>
                    <TecnicoOrden />
                  </RequiereRol>
                }
              />
              <Route
                path="configuracion"
                element={
                  <RequiereRol roles={['administrador']}>
                    <Configuracion />
                  </RequiereRol>
                }
              />
              <Route path="mi-cuenta" element={<MiCuenta />} />
              <Route path="*" element={<NoEncontrado />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
