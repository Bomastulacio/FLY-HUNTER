import os
import html
import urllib.parse
import resend

resend.api_key = os.environ.get("RESEND_API_KEY", "")
alert_email_to = os.environ.get("ALERT_EMAIL_TO", "")

def _safe_booking_url(url_str: str) -> str:
    """Valida que la URL de reserva sea HTTPS y pertenezca a dominios de confianza."""
    try:
        parsed = urllib.parse.urlparse(str(url_str).strip())
        if parsed.scheme == 'https':
            allowed_hosts = ('google.com', 'despegar.com.ar', 'despegar.com')
            host = parsed.netloc.lower()
            if any(host == d or host.endswith('.' + d) for d in allowed_hosts):
                return html.escape(url_str, quote=True)
    except Exception:
        pass
    return "https://www.google.com/travel/flights"

def send_email(subject: str, html_content: str) -> None:
    if not resend.api_key or not alert_email_to:
        print("Warning: Resend credentials not found. Email not sent.")
        print(f"[Email Preview] Subject: {subject}\nContent: {html_content}")
        return
    
    try:
        r = resend.Emails.send({
            "from": "Flight Hunter <onboarding@resend.dev>",
            "to": alert_email_to,
            "subject": subject,
            "html": html_content
        })
        print(f"Email sent successfully: {r}")
    except Exception as e:
        print(f"Error sending email: {e}")

def notify_golden_opportunity(deal: dict) -> None:
    precio_orig = deal.get('precio_original', deal.get('precio_total_usd', 0))
    moneda_orig = html.escape(str(deal.get('moneda_original', 'USD')))
    precio_usd = deal.get('precio_total_usd', 0)
    
    ruta_ida = html.escape(str(deal.get('ida_origen_destino', '')))
    ruta_vuelta = html.escape(str(deal.get('vuelta_origen_destino', '')))
    aerolinea = html.escape(str(deal.get('aerolinea', '')))
    fecha_ida = html.escape(str(deal.get('ida_fecha', '')))
    fecha_vuelta = html.escape(str(deal.get('vuelta_fecha', '')))
    safe_link = _safe_booking_url(deal.get('link_reserva', ''))
    
    subject = f"🌟 OPORTUNIDAD DE ORO: {ruta_ida} a {precio_orig} {moneda_orig}"
    html_content = f"""
    <h2>¡Oportunidad de Oro Encontrada!</h2>
    <p>Se encontró una oferta increíble que cumple los criterios críticos.</p>
    <ul>
        <li><strong>Ruta:</strong> {ruta_ida} / {ruta_vuelta}</li>
        <li><strong>Precio:</strong> {precio_orig:,.2f} {moneda_orig} <em>(aprox. ${precio_usd} USD)</em></li>
        <li><strong>Fechas:</strong> {fecha_ida} - {fecha_vuelta}</li>
        <li><strong>Aerolínea:</strong> {aerolinea}</li>
    </ul>
    <p><a href="{safe_link}" target="_blank" rel="noopener noreferrer">Reservar ahora</a></p>
    """
    send_email(subject, html_content)

def notify_anomaly(deal: dict) -> None:
    precio_orig = deal.get('precio_original', deal.get('precio_total_usd', 0))
    moneda_orig = html.escape(str(deal.get('moneda_original', 'USD')))
    precio_usd = deal.get('precio_total_usd', 0)
    
    ruta_ida = html.escape(str(deal.get('ida_origen_destino', '')))
    ruta_vuelta = html.escape(str(deal.get('vuelta_origen_destino', '')))
    fecha_ida = html.escape(str(deal.get('ida_fecha', '')))
    fecha_vuelta = html.escape(str(deal.get('vuelta_fecha', '')))
    
    subject = f"❓ Anomalía Pendiente de Aprobación: {ruta_ida} por {precio_orig} {moneda_orig}"
    html_content = f"""
    <h2>Anomalía Detectada</h2>
    <p>Se encontró una oferta atractiva pero que rompe algún parámetro (ej. fechas o escalas). Requiere revisión manual.</p>
    <ul>
        <li><strong>Ruta:</strong> {ruta_ida} / {ruta_vuelta}</li>
        <li><strong>Precio:</strong> {precio_orig:,.2f} {moneda_orig} <em>(aprox. ${precio_usd} USD)</em></li>
        <li><strong>Fechas:</strong> {fecha_ida} - {fecha_vuelta}</li>
    </ul>
    <p>Por favor revisá el panel de control de Flight Hunter para aprobar o rechazar esta oferta.</p>
    """
    send_email(subject, html_content)

def notify_glitch_fare(deal: dict) -> None:
    precio_orig = deal.get('precio_original', deal.get('precio_total_usd', 0))
    moneda_orig = html.escape(str(deal.get('moneda_original', 'USD')))
    precio_usd = deal.get('precio_total_usd', 0)
    
    ruta_ida = html.escape(str(deal.get('ida_origen_destino', '')))
    ruta_vuelta = html.escape(str(deal.get('vuelta_origen_destino', '')))
    aerolinea = html.escape(str(deal.get('aerolinea', '')))
    fecha_ida = html.escape(str(deal.get('ida_fecha', '')))
    fecha_vuelta = html.escape(str(deal.get('vuelta_fecha', '')))
    safe_link = _safe_booking_url(deal.get('link_reserva', ''))
    
    subject = f"🚨 TARIFA ERROR DETECTADA: {ruta_ida} a {precio_orig} {moneda_orig}"
    html_content = f"""
    <h2 style="color: red;">¡ALERTA MÁXIMA: TARIFA ERROR!</h2>
    <p><strong>El Agente Crítico ha detectado un precio matemáticamente absurdo. Esto es un "Glitch Fare" y probablemente la aerolínea lo corrija en minutos. ¡COMPRA AHORA!</strong></p>
    <ul>
        <li><strong>Ruta:</strong> {ruta_ida} / {ruta_vuelta}</li>
        <li><strong>Precio:</strong> {precio_orig:,.2f} {moneda_orig} <em>(aprox. ${precio_usd} USD)</em></li>
        <li><strong>Fechas:</strong> {fecha_ida} - {fecha_vuelta}</li>
        <li><strong>Aerolínea:</strong> {aerolinea}</li>
    </ul>
    <p><a href="{safe_link}" target="_blank" rel="noopener noreferrer" style="background-color: red; color: white; padding: 10px 20px; text-decoration: none; font-weight: bold;">RESERVAR ANTES DE QUE DESAPAREZCA</a></p>
    """
    send_email(subject, html_content)
