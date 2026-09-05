# Fly Hunter UI & Layout Guidelines

Cuando construyas o edites componentes visuales (HTML/Astro/CSS) para Fly Hunter, siempre debes adherirte a las siguientes reglas de CSS y Jerarquía Visual. Estas reglas nacen de la optimización del Dashboard, el Feed de vuelos y el Wizard de la aplicación.

## 1. Robustez del CSS Grid (Prevención de Overflow)
- **Nunca** uses `1fr` de forma desnuda en `grid-template-columns` cuando el grid contenga elementos de formulario (inputs), rangos de fecha o textos largos.
- **Siempre** usa `minmax(0, 1fr)` en su lugar. Esto fuerza a que el contenido respete el ancho máximo de su track y prevenga desbordamientos horizontales (overflows) en tarjetas y modals.
- En tarjetas estrechas, si los campos de formulario comparten una fila y se quedan sin espacio (ej. un input dual "Desde/Hasta"), utiliza `flex-direction: column` para apilarlos internamente en lugar de forzar el grid lateralmente o usar wrap.

## 2. Jerarquía Estricta de Botones y Acciones
- **Botón Primario (Verde sólido/Neón):** Reservado EXCLUSIVAMENTE para la conversión principal del negocio (Ej. "Reserva en Google Flights", "Ver Vuelo", "Siguiente Paso"). Solo debe haber UNO compitiendo por jerarquía principal por tarjeta/vista. El verde NO debe usarse en badges informativos ni en estados "en progreso / buscando".
- **Acciones Secundarias/Mantenimiento:** Las acciones como "Editar Radar", "Borrar", o ajustes rápidos contextuales deben implementarse SIEMPRE como **íconos ghost** (sin relleno ni bordes, usando opacidad e iconos como lápiz o basura, ej. `btn-icon`) o texto sutil. NUNCA deben usar clases primarias ni competir visualmente con el botón de conversión.
- **Principio de Affordance Único:** Nunca coloques dos controles distintos para la misma acción dentro de una misma tarjeta (ej. NO poner un enlace "Editar" en la cabecera y un botón "Modificar radar" en el pie). Deja un único punto de entrada claro con la jerarquía visual adecuada.
- **Tarjetas Informativas vs Accionables:** Las tarjetas de métricas secundarias (ej. estados de proceso de scrapers, cronómetros como "Próximo Rastreo" o "Empty states") deben tener un contraste sutil (ej. bordes transparentes o backgrounds rebajados al 2%) para no restarle importancia visual a las tarjetas accionables principales.

## 3. Principio de CTA Único para la Opción Ganadora
- En las tarjetas de vuelos (Bento Grid y destinos secundarios), **nunca coloques múltiples botones de reserva compitiendo entre sí** (ej. no poner "Ver en Google Flights" y "Ver en Despegar" al mismo tiempo en la misma tarjeta).
- El sistema debe comparar internamente todas las fuentes disponibles y renderizar **un único botón principal** hacia la plataforma ganadora (la que ofrezca la tarifa más baja comprobada):
  - Si la mejor tarifa es de Google Flights: botón verde `Ver en Google Flights` (con parámetros forzados para los pasajeros exactos del radar).
  - Si la mejor tarifa es de Despegar: botón `Ver en Despegar`.

## 4. Consistencia de Anchos y Layout Desktop (2 Columnas)
- **Anchos 100% Idénticos entre Cards Hermanas:** Nunca asignes anchos fijos en px ni `grid-column: span 2` a la tarjeta destacada principal si las tarjetas inferiores ocupan el ancho completo. Todas las tarjetas en la columna de feed deben ocupar el `width: 100%; box-sizing: border-box;` del contenedor.
- **Dashboard de 2 Columnas en Desktop (≥1024px):**
  - **Sidebar izquierda (340px, sticky):** Contador de próximo rastreo y Panel de filtros del radar siempre expandido y visible (aprovechando el ancho del monitor sin forzar colapso a pill).
  - **Feed derecho (flex 1, max ~800px):** Tarjeta destacada y grid de destinos en seguimiento compartiendo el mismo ancho horizontal.
- **Preservación Estricta de Mobile (<1024px):** Toda mejora de escritorio debe aislarse mediante media queries (`@media (min-width: 1024px)`). En pantallas móviles se debe mantener siempre la columna única con pill compacta y countdown apilados sin alterar la experiencia táctil validada.

## 5. Tipografía de Precios y Badges de País
- **Precios Indivisibles (`white-space: nowrap`):** Nunca permitas que el símbolo de moneda y el número de un presupuesto o tarifa se separen en dos líneas (ej. `"US$"` en una línea y `"2400"` en la siguiente). Utiliza siempre `white-space: nowrap` o espacio no separable (`US$&nbsp;${monto}`).
- **Chips ISO para Países:** En lugar de emojis de banderas (que en Windows y ciertos navegadores renderizan letras planas o glitches), utiliza chips explícitos con código ISO (`[ES] España`, `[GB] Reino Unido`, `[FR] Francia`) con tipografía monoespaciada estilizada (`.country-iso-badge`).
- **Grids Auto-ajustables:** Para listas de destinos que puedan variar en cantidad, usa `repeat(auto-fit, minmax(240px, 1fr))` con gap consistente para que salten de fila ordenadamente sin apretarse.
