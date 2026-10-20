# Estados y flujos

## Solicitud de instalación

```mermaid
stateDiagram-v2
  [*] --> nueva
  nueva --> en_factibilidad : se analiza
  en_factibilidad --> factible : supervisor aprueba
  en_factibilidad --> no_factible : supervisor rechaza (motivo obligatorio)
  en_factibilidad --> pendiente_info : faltan datos
  pendiente_info --> en_factibilidad : se completan
  factible --> puerto_reservado : reserva transaccional de puerto
  puerto_reservado --> factible : vence la reserva (72 h configurable)
  puerto_reservado --> orden_generada : se crea la OT de instalación
  orden_generada --> instalada : OT completada
  instalada --> activada : cliente activo y puerto ocupado
  nueva --> cancelada
  en_factibilidad --> cancelada
  factible --> cancelada
  puerto_reservado --> cancelada : libera el puerto
  orden_generada --> cancelada : libera el puerto
  activada --> [*]
  no_factible --> [*]
  cancelada --> [*]
```

La factibilidad es una **recomendación** basada en los datos registrados (NAP cercanas, puertos libres, ruta hasta la OLT, distancia, presupuesto óptico). La decisión la toma una persona.

## Orden de trabajo

```mermaid
stateDiagram-v2
  [*] --> pendiente
  pendiente --> asignada : se asigna técnico
  asignada --> en_camino : técnico
  en_camino --> en_ejecucion : técnico (registra hora de inicio)
  asignada --> en_ejecucion : técnico
  en_ejecucion --> completada : técnico (potencia, pruebas, hora de cierre)
  pendiente --> cancelada : gestión
  asignada --> cancelada : gestión
  en_camino --> cancelada : gestión
  en_ejecucion --> cancelada : gestión
  completada --> [*]
  cancelada --> [*]
```

Desde la Etapa 1 la base de datos ya garantiza que: una orden en estado distinto de *pendiente* o *cancelada* tiene técnico; al pasar a *en ejecución* se registra la hora de inicio; al completarse o cancelarse se registra la hora de cierre; y un técnico no puede cancelar, reasignar ni reabrir una orden cerrada.

## Puerto de NAP

```mermaid
stateDiagram-v2
  [*] --> libre
  libre --> reservado : solicitud factible
  reservado --> libre : vence o se cancela
  reservado --> ocupado : instalación completada
  libre --> ocupado : asignación directa a cliente existente
  ocupado --> libre : cliente retirado
  libre --> averiado : supervisor
  averiado --> libre : reparado
```

## Cliente

`pendiente → activo → suspendido ⇄ activo → retirado`. Cada cambio queda en el historial del cliente y en la auditoría.
