import os
import resend

resend.api_key = os.environ.get("RESEND_API_KEY", "")
alert_email_to = os.environ.get("ALERT_EMAIL_TO", "")

def send_email(subject: str, html_content: str) -> None:
    if not resend.api_key or not alert_email_to:
        print("Warning: Resend credentials not found. Email not sent.")
        print(f"[Email Preview] Subject: {subject}\nContent: {html_content}")
        return
    
    try:
        r = resend.Emails.send({
            "from": "Flight Hunter <alerts@tu-dominio.com>", # TODO: reemplazar con dominio verificado de Resend
            "to": alert_email_to,
            "subject": subject,
            "html": html_content
        })
        print(f"Email sent successfully: {r}")
    except Exception as e:
        print(f"Error sending email: {e}")

def notify_golden_opportunity(deal: dict) -> None:
    subject = f"🚨 OPORTUNIDAD DE ORO: {deal['ida_origen_destino']} a {deal['precio_total_usd']} USD"
    html = f"""
    <h2>¡Oportunidad de Oro Encontrada!</h2>
    <p>Se encontró una oferta increíble que cumple los criterios críticos.</p>
    <ul>
        <li><strong>Ruta:</strong> {deal['ida_origen_destino']} / {deal['vuelta_origen_destino']}</li>
        <li><strong>Precio Total (2 pax):</strong> ${deal['precio_total_usd']} USD</li>
        <li><strong>Fechas:</strong> {deal['ida_fecha']} - {deal['vuelta_fecha']}</li>
        <li><strong>Aerolínea:</strong> {deal['aerolinea']}</li>
    </ul>
    <p><a href="{deal['link_reserva']}">Reservar ahora</a></p>
    """
    send_email(subject, html)

def notify_anomaly(deal: dict) -> None:
    subject = f"⚠️ Anomalía Pendiente de Aprobación: {deal['ida_origen_destino']} por {deal['precio_total_usd']} USD"
    html = f"""
    <h2>Anomalía Detectada</h2>
    <p>Se encontró una oferta atractiva pero que rompe algún parámetro (ej. fechas o escalas). Requiere revisión manual.</p>
    <ul>
        <li><strong>Ruta:</strong> {deal['ida_origen_destino']} / {deal['vuelta_origen_destino']}</li>
        <li><strong>Precio Total (2 pax):</strong> ${deal['precio_total_usd']} USD</li>
        <li><strong>Fechas:</strong> {deal['ida_fecha']} - {deal['vuelta_fecha']}</li>
    </ul>
    <p>Por favor revisá el panel de control de Flight Hunter para aprobar o rechazar esta oferta.</p>
    """
    send_email(subject, html)
