import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { tieneRol } from '../lib/roles';
import { crearOrdenesMasivas } from '../ordenes/api';
import { Download, MessageCircle, Phone } from 'lucide-react';
import { Link } from 'react-router';
import { analizarImpacto, type TipoImpacto } from './api';
import { mensajeError } from '../lib/errores';
import { aCsv, descargarCsv, fechaArchivo } from '../lib/csv';
import { formatearTelefono } from '../lib/formato';
import { Aviso, Boton, Cargando } from '../components/ui';

/** NAP y clientes que dependen de un cable, hilo, puerto PON o elemento. */
export function ImpactoPanel({ tipo, id, nombre }: { tipo: TipoImpacto; id: string; nombre: string }) {
  const q = useQuery({ queryKey: ['red', 'impacto', tipo, id], queryFn: () => analizarImpacto(tipo, id) });
  const { roles } = useAuth();
  const esSupervisor = tieneRol(roles, 'supervisor_red');
  const qc = useQueryClient();
  const [resultadoMasivo, setResultadoMasivo] = useState('');
  const masivas = useMutation({
    mutationFn: (descripcion: string) => crearOrdenesMasivas(tipo, id, descripcion, 'alta'),
    onSuccess: async (r) => {
      setResultadoMasivo(
        `Se crearon ${r.creadas} órdenes de reparación` + (r.omitidas ? ` (${r.omitidas} clientes ya tenían una abierta).` : '.'),
      );
      await qc.invalidateQueries({ queryKey: ['ordenes'] });
    },
  });

  if (q.isPending) return <Cargando texto="Calculando afectados…" />;
  if (q.isError) return <Aviso tipo="error">{mensajeError(q.error)}</Aviso>;
  const r = q.data;
  const clientes = r.naps.flatMap((n) => n.clientes.map((c) => ({ ...c, nap: n.codigo })));
  const visibles = clientes.length;

  function exportar() {
    descargarCsv(
      `afectados-${nombre}-${fechaArchivo()}.csv`,
      aCsv(clientes, [
        { titulo: 'NAP', valor: (c) => c.nap },
        { titulo: 'Puerto', valor: (c) => c.puerto },
        { titulo: 'Código', valor: (c) => c.codigo },
        { titulo: 'Cliente', valor: (c) => c.nombre },
        { titulo: 'Teléfono', valor: (c) => c.telefono },
        { titulo: 'WhatsApp', valor: (c) => c.whatsapp },
        { titulo: 'Estado', valor: (c) => c.estado },
      ]),
    );
  }

  if (r.total_naps === 0) {
    return <p className="text-tenue">Según las conexiones registradas, ninguna NAP depende de {nombre}.</p>;
  }

  return (
    <div>
      <p>
        <span className="cifra text-xl font-semibold">{r.total_naps}</span> NAP y{' '}
        <span className="cifra text-xl font-semibold">{r.total_puertos_ocupados}</span> puertos ocupados dependen de {nombre}.
      </p>
      {visibles < r.total_puertos_ocupados && (
        <p className="mt-1 text-sm text-tenue">Su rol no permite ver los datos de todos los clientes afectados.</p>
      )}
      {visibles > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Boton variante="secundario" className="px-3 py-1.5 text-sm" onClick={exportar}>
            <Download className="size-4" aria-hidden /> Exportar afectados (CSV)
          </Boton>
          {esSupervisor && (
            <Boton variante="secundario" className="px-3 py-1.5 text-sm" cargando={masivas.isPending}
              onClick={() => {
                const d = window.prompt(`Describa la falla para las órdenes de reparación (${visibles} clientes):`, `Falla en ${nombre}`);
                if (d && d.trim()) masivas.mutate(d.trim());
              }}>
              Crear órdenes de reparación
            </Boton>
          )}
        </div>
      )}
      {resultadoMasivo && <div className="mt-2"><Aviso tipo="exito">{resultadoMasivo}</Aviso></div>}
      {masivas.isError && <div className="mt-2"><Aviso tipo="error">{mensajeError(masivas.error)}</Aviso></div>}
      <ul className="mt-4 flex flex-col gap-3">
        {r.naps.map((n) => (
          <li key={n.id}>
            <p className="font-medium">
              <Link to={`/mapa?elemento=${n.id}`} className="text-acento hover:underline">{n.codigo}</Link>{' '}
              <span className="text-sm font-normal text-tenue">{n.puertos_ocupados} ocupados</span>
            </p>
            {n.clientes.length > 0 && (
              <ul className="mt-1 flex flex-col gap-1 border-l-2 border-linea pl-3 text-sm">
                {n.clientes.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-2">
                    <span className="cifra text-tenue">#{c.puerto}</span>
                    <Link to={`/clientes/${c.id}`} className="text-acento hover:underline">{c.nombre}</Link>
                    {c.telefono && (
                      <a href={`tel:${c.telefono}`} className="inline-flex items-center gap-1 text-tenue hover:text-tinta">
                        <Phone className="size-3.5" aria-hidden /> {formatearTelefono(c.telefono)}
                      </a>
                    )}
                    {c.whatsapp && (
                      <a
                        href={`https://wa.me/${c.whatsapp.replace('+', '')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-tenue hover:text-tinta"
                        aria-label={`WhatsApp de ${c.nombre}`}
                      >
                        <MessageCircle className="size-3.5" aria-hidden />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-tenue">Cálculo basado en las conexiones registradas; no considera rutas físicas sin registrar.</p>
    </div>
  );
}
