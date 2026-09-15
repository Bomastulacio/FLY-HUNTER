# Extensión de Captura Personal - Flight Hunter

Extensión local para Google Chrome, Microsoft Edge y navegadores basados en Chromium (Brave, Opera).

Permite capturar cotizaciones reales observadas personalmente por el usuario en **Despegar** y **Aerolíneas Argentinas**, validando pasajeros, escalas y condiciones de pago, para exportarlas como un archivo JSON normalizado (versión 1) e importarlas directamente en `/capturas` de Flight Hunter.

## Principios de privacidad y seguridad

- **Permisos mínimos:** Únicamente `activeTab` y `scripting`.
- **Cero telemetría:** No almacena ni transmite cookies, credenciales, tokens de autenticación, datos personales (PII) ni el HTML completo del sitio.
- **Acción exclusiva del usuario:** Solo lee la pestaña cuando el usuario hace clic deliberadamente en «Capturar cotización visible».
- **Sin seguimiento automático:** Las cotizaciones guardadas como captura personal se archivan en `saved_deals` de tu cuenta con fuente `manual_capture` y quedan exentas del seguimiento automático de proveedores en segundo plano.

## Instrucciones de Instalación

1. Abrí tu navegador basado en Chromium (Chrome o Edge).
2. Ingresá a la página de extensiones:
   - En **Google Chrome**: `chrome://extensions`
   - En **Microsoft Edge**: `edge://extensions`
   - En **Brave**: `brave://extensions`
3. Activá el interruptor **Modo de desarrollador** (Developer mode) en la esquina superior derecha.
4. Hacé clic en el botón **Cargar descomprimida** (Load unpacked).
5. Seleccioná la carpeta `extension` dentro de tu repositorio Flight Hunter.
6. ¡Listo! Verás el ícono de Flight Hunter en tu barra de herramientas del navegador. Te sugerimos fijarlo (pin) para tenerlo a mano.

## Instrucciones de Uso

1. **Navegar a la oferta:**
   - En **Despegar**: buscá y seleccioná un vuelo de ida y vuelta para el número deseado de pasajeros.
   - En **Aerolíneas Argentinas**: seleccioná los vuelos de ida y vuelta hasta ver el resumen de itinerario y precio total.
2. **Capturar:**
   - Abrí la extensión de Flight Hunter haciendo clic en su ícono.
   - Hacé clic en **«📷 Capturar cotización visible»**.
   - La extensión analizará el texto visible y precompletará origen, destino, fechas, pasajeros, precio total en USD, aerolínea y escalas.
3. **Revisar y Exportar:**
   - Revisá los datos en el formulario integrado. Si falta algún detalle o el proveedor mostró un monto ambiguo, podés ajustarlo o confirmarlo directamente en la ventana.
   - Hacé clic en **«💾 Descargar JSON para Flight Hunter»**. Se descargará un archivo `.json` liviano y normalizado.
4. **Importar en Flight Hunter:**
   - Abrí tu app de Flight Hunter en la sección **`/capturas`** (podés usar el enlace directo en la extensión).
   - Arrastrá el archivo `.json` al panel de importación.
   - Revisá el resumen en vivo y hacé clic en **«Guardar en mis vuelos personales»**.
   - Tu cotización quedará archivada en tu cuenta bajo **Guardados**, claramente identificada con el badge **«Captura personal»**.

## Caso Turismocity

Turismocity actúa como metabuscador redirigiendo a múltiples agencias y aerolíneas externas. Para garantizar que los montos, escalas y condiciones sean exactos y fidedignos, la extensión notifica al usuario para realizar la carga manual directamente en `/capturas`.
