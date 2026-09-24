# Fly Hunter — estudio interactivo 01

Prototipo visual aprobado como siguiente paso en la conversación del 24/09/2026.
Es independiente del frontend de producción. No modifica rutas Astro, datos,
Auth, búsquedas, presupuesto de proveedores ni emails. No requiere credenciales.
Todas las cotizaciones son ejemplos identificados como tales; no son ofertas reales.

## Abrir

Desde la raíz del repositorio:

```powershell
node evals/preview_concept.mjs
```

Abrir http://127.0.0.1:4323. El servidor solo escucha en loopback.
Fotos y tipografía son locales; los iconos Phosphor 2.1.1 requieren conexión a jsDelivr.
Las preferencias y los guardados viven en memoria y se reinician al recargar.

## Qué se puede probar

- España como menor precio e Italia como país siempre visible.
- Fijar otro país desde las filas o las preferencias; si también gana, no se duplica.
- Guardar/quitar una cotización y consultar Guardados; se conserva el importe guardado.
- Desplegar detalles de ida y vuelta, con CTA de demostración que no abre proveedores.
- Elegir países, ventanas de fechas, rango de noches, presupuesto y umbral de aviso.
- Resumen del formulario en vivo, validación de ventanas/noches/precio objetivo.
- Si las fechas ya no incluyen la observación de ejemplo, mostrar un estado vacío.
- Escenarios: Italia gana, todas las opciones superan presupuesto, sin datos y bloqueo.
- Inclinación hasta 2 grados por eje y reflejo con mouse; compresión al tocar.
- Desactivar movimiento; también se respeta prefers-reduced-motion y transparencia reducida.
- Countdown a las 09:00/21:00 UTC con horario de Argentina. No programa una búsqueda.

## Dirección de diseño

Cristal ahumado verde, acento lima, fotografías contenidas y tipografía Plus Jakarta Sans.
La ganadora y el país fijado tienen protagonismo; las alternativas son filas compactas.
Phosphor se mantiene como única familia de iconos. Datos apilados y detalle progresivo.
La navegación permanece al alcance del pulgar y el scroll sigue siendo nativo.

Referencias investigadas; se adaptan principios visuales, no se copia su código:

- https://builtbydesigners.com/ — catálogo y selección de referencias.
- https://sashabalandina.com/weather-os — atmósfera y controles sobre fondo visual.
- https://been-there.suepark.xyz/ — identidad de destino y materialidad.
- https://github.com/rikkijanae/shiny-sticker-figma-plugin — acabado de reflejos.
- https://orbkit.zzzzshawn.cloud/ — iluminación y profundidad.
- https://dialkit.dev/ — ajuste fino de interacción como método de trabajo.
- https://developer.apple.com/videos/play/wwdc2025/219/ — material y jerarquía.

## Recursos

Fotos de Unsplash descargadas para esta vista previa, sin representar evidencia de vuelos:

- Madrid: https://images.unsplash.com/photo-1543783207-ec64e4d95325
- Roma: https://images.unsplash.com/photo-1552832230-c0197dd311b5
- París: https://images.unsplash.com/photo-1502602898657-3e91760cbb34
- Lisboa: https://images.unsplash.com/photo-1555881400-74d7acaacd8b
- Plus Jakarta Sans: Google Fonts, https://fonts.google.com/specimen/Plus+Jakarta+Sans
- Phosphor: https://phosphoricons.com/

## Validación realizada

- Sintaxis JavaScript del cliente y servidor.
- Navegador: guardados, país fijado, resumen en vivo, presupuesto, ganador sin duplicación,
  detalle desplegable y escenario sin cotizaciones.
- 360, 390, 768 y 1280 px: imágenes cargadas y sin desborde horizontal.
- Logs del navegador sin errores durante esta comprobación.
- TypeScript del agente, 37 tests offline (incluyen PGlite/RLS) y build Astro aprobados.
- No se cambió Python; no se ejecutaron sus evals ni consultas a proveedores.

La prueba de tamaños usa Chromium, no valida Safari ni dispositivos físicos.
El widget nativo, las preferencias persistentes y las alertas por precio objetivo no se
implementan en este prototipo. La secuencia de integración sigue en MONITORING.md.
