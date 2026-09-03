# Fly Hunter UI & Layout Guidelines

Cuando construyas o edites componentes visuales (HTML/Astro/CSS) para Fly Hunter, siempre debes adherirte a las siguientes reglas de CSS y Jerarquía Visual. Estas reglas nacen de la optimización del Dashboard y el Wizard de la aplicación.

## 1. Robustez del CSS Grid (Prevención de Overflow)
- **Nunca** uses `1fr` de forma desnuda en `grid-template-columns` cuando el grid contenga elementos de formulario (inputs), rangos de fecha o textos largos.
- **Siempre** usa `minmax(0, 1fr)` en su lugar. Esto fuerza a que el contenido respete el ancho máximo de su track y prevenga desbordamientos horizontales (overflows) en tarjetas y modals.
- En tarjetas estrechas, si los campos de formulario comparten una fila y se quedan sin espacio (ej. un input dual "Desde/Hasta"), utiliza `flex-direction: column` para apilarlos internamente en lugar de forzar el grid lateralmente o usar wrap.

## 2. Jerarquía Estricta de Botones y Acciones
- **Botón Primario (Verde sólido/Neón):** Reservado EXCLUSIVAMENTE para la conversión principal del negocio (Ej. "Reserva en Google Flights", "Ver Vuelo", "Siguiente Paso"). Solo debe haber UNO compitiendo por jerarquía principal por tarjeta/vista.
- **Acciones Secundarias/Mantenimiento:** Las acciones como "Editar Radar", "Borrar", o ajustes rápidos contextuales deben implementarse SIEMPRE como **íconos ghost** (sin relleno ni bordes, usando opacidad e iconos como lápiz o basura, ej. `btn-icon`) o texto sutil. NUNCA deben usar clases primarias ni competir visualmente con el botón de conversión.
- **Tarjetas Informativas vs Accionables:** Las tarjetas de métricas secundarias (ej. estados de proceso de scrapers, cronómetros como "Próximo Rastreo" o "Empty states") deben tener un contraste sutil (ej. bordes transparentes o backgrounds rebajados al 2%) para no restarle importancia visual a las tarjetas accionables principales.

## 3. Principio de CTA Único para la Opción Ganadora
- En las tarjetas de vuelos (Bento Grid y destinos secundarios), **nunca coloques múltiples botones de reserva compitiendo entre sí** (ej. no poner "Ver en Google Flights" y "Ver en Despegar" al mismo tiempo en la misma tarjeta).
- El sistema debe comparar internamente todas las fuentes disponibles y renderizar **un único botón principal** hacia la plataforma ganadora (la que ofrezca la tarifa más baja comprobada):
  - Si la mejor tarifa es de Google Flights: botón verde `Ver en Google Flights` (con parámetros forzados para los pasajeros exactos del radar).
  - Si la mejor tarifa es de Despegar: botón `Ver en Despegar`.
