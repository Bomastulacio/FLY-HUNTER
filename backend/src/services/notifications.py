"""Radar-scoped emails from the existing graph, with durable delivery receipts."""
import hashlib
import html
import math
import os
from datetime import datetime, timezone, timedelta
from urllib.parse import urlencode, urlparse

import requests

from .db import get_supabase_client, mark_as_notified


def _observed_at(deal):
    value = (deal.get('detalle_cotizacion') or {}).get('observedAt') or deal.get('created_at')
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except (ValueError, TypeError):
        return None


def notification_kind(deal: dict, radar: dict, now=None):
    """A low price never bypasses evidence, route, passenger or airline constraints."""
    from ..agents.critic import _hard_eligible, _date_distance
    from .geography import destination_airports, radar_targets, origin_airports
    now = now or datetime.now(timezone.utc)
    if not radar.get('id') or not radar.get('user_id') or not radar.get('activo', True) or radar.get('notificar_email') is False:
        return None
    evidence = deal.get('detalle_cotizacion') or {}
    observed = _observed_at(deal)
    if not observed or not timedelta(0) <= now - observed < timedelta(hours=24):
        return None
    if evidence.get('priceBasis') != 'party_total' or evidence.get('passengersVerified') is not True or evidence.get('itineraryScope') != 'roundtrip':
        return None
    stops = evidence.get('stopsPerDirection')
    try:
        limit = min(1, int(radar.get('escalas_max') if radar.get('escalas_max') is not None else 1))
    except (ValueError, TypeError):
        return None
    if not isinstance(stops, list) or len(stops) != 2 or any(type(s) is not int or not 0 <= s <= limit for s in stops):
        return None
    if deal.get('fuente') not in ('google_flights', 'despegar', 'serpapi') or not _hard_eligible(deal, [radar]):
        return None
    if deal.get('fuente') == 'google_flights' and not (evidence.get('priceVerified') and evidence.get('queryVerified') and evidence.get('googleParserVersion') == 2):
        return None
    try:
        origin, destination = deal['ida_origen_destino'].split('-')
        origins = origin_airports(radar.get('origen', ''))
        targets = radar_targets(radar)
        airports = [a for target in targets for a in destination_airports(target)]
        total = float(deal['precio_total_usd'])
        ceiling = float(radar['presupuesto_max'])
        if not math.isfinite(ceiling) or ceiling <= 0 or origin not in origins or destination not in airports or deal.get('vuelta_origen_destino') != f'{destination}-{origin}' or total > ceiling:
            return None
        status = deal.get('estado_aprobacion')
        distance = _date_distance(deal, radar)
        if status == 'pendiente' and deal.get('es_anomalia') and distance <= 1:
            return 'review'
        if status != 'aprobado' or distance != 0:
            return None
        target = float(radar.get('precio_aviso_usd') or 0)
        golden = total < 750 * int(radar['pasajeros'])
        low = float(radar.get('presupuesto_min') or 0)
        if golden or (math.isfinite(target) and low <= total <= min(target, ceiling) and target > 0):
            return 'opportunity'
    except (ValueError, TypeError, KeyError):
        return None
    return None


def _recipient(client, radar):
    # Radar fields are editable; deliver only to the owner's verified Auth email.
    user = client.auth.admin.get_user_by_id(radar['user_id']).user
    if not user or not user.email or not user.email_confirmed_at:
        return None
    return user.email


def _payload(deal, radar, recipient, kind):
    e = html.escape
    amount = 'US$' + format(float(deal['precio_total_usd']), ',.0f').replace(',', '.')
    name = str(radar.get('nombre') or radar.get('destino') or 'Tu radar')
    title = 'Una oportunidad para tu viaje' if kind == 'opportunity' else 'Una cotización necesita revisión'
    app_url = os.environ.get('APP_URL', '').rstrip('/')
    valid_app = urlparse(app_url)
    if valid_app.scheme == 'https' and valid_app.netloc and not valid_app.username:
        link = app_url + '/?' + urlencode({'radar': radar['id']})
        cta = 'Abrir mi radar'
    else:
        origin, destination = deal['ida_origen_destino'].split('-')
        query = f"Flights to {destination} from {origin} on {deal['ida_fecha']} through {deal['vuelta_fecha']} for {deal['pasajeros']} adults"
        link = 'https://www.google.com/travel/flights?' + urlencode({'q': query, 'curr': 'USD', 'hl': 'es'})
        cta = 'Revisar búsqueda en Google Flights'
    body = f"""<div style="background:#131b16;color:#eef3e8;padding:32px;font-family:Arial,sans-serif;max-width:560px">
      <p style="color:#c9ef91">FLIGHT HUNTER · {e(name)}</p><h1>{title}</h1>
      <p style="font-size:32px">{amount}</p><p>Total para {int(deal['pasajeros'])} adultos · ida y vuelta</p>
      <p>{e(deal['ida_origen_destino'])} · {e(deal['aerolinea'])}<br>{e(deal['ida_fecha'])} al {e(deal['vuelta_fecha'])}</p>
      <p>{'Coincide con tu viaje y cumple el precio de aviso o el umbral excepcional.' if kind == 'opportunity' else 'Presenta un desvío permitido y queda pendiente de revisión; todavía no es una oferta aprobada.'}</p>
      <p><a style="color:#d2ef9b" href="{e(link, quote=True)}">{cta}</a></p>
      <p style="color:#b0bbaa;font-size:13px">Precio observado, sujeto a disponibilidad. Confirmá el total y las condiciones en el proveedor antes de comprar.</p></div>"""
    return {'from': os.environ.get('RESEND_FROM', 'Flight Hunter <onboarding@resend.dev>'),
            'to': [recipient], 'subject': f'{name}: {amount} · {title}', 'html': body}


def send_email(payload: dict, key: str):
    api_key = os.environ.get('RESEND_API_KEY')
    if not api_key:
        return None
    response = requests.post('https://api.resend.com/emails', json=payload,
        headers={'Authorization': f'Bearer {api_key}', 'Idempotency-Key': key}, timeout=20)
    response.raise_for_status()
    return response.json().get('id')


def notify_radar_deals(deals: list, radar: dict) -> None:
    candidates = [(d, notification_kind(d, radar)) for d in deals]
    candidates = [(d, kind) for d, kind in candidates if kind]
    if not candidates or not os.environ.get('RESEND_API_KEY'):
        return
    client = get_supabase_client()
    recipient = _recipient(client, radar)
    if not recipient:
        return
    for deal, kind in candidates:
        key = hashlib.sha256(f"{radar['id']}:{deal['hash_dedupe']}:{kind}".encode()).hexdigest()
        client.table('radar_email_deliveries').upsert({'id': key, 'radar_id': radar['id'], 'deal_hash': deal['hash_dedupe'], 'kind': kind,
            'payload': _payload(deal, radar, recipient, kind)}, on_conflict='id', ignore_duplicates=True).execute()
        receipt = client.table('radar_email_deliveries').select('*').eq('id', key).single().execute().data
        if receipt.get('sent_at'):
            continue
        created = datetime.fromisoformat(receipt['created_at'].replace('Z', '+00:00'))
        # Resend retains keys for 24h. Never replay an ambiguous delivery after that window.
        if datetime.now(timezone.utc) - created >= timedelta(hours=23):
            print(f"Email delivery {key}: pending receipt requires review; not replayed.")
            continue
        # An account email change must not send an old request to its former address.
        if receipt['payload'].get('to') != [recipient]:
            continue
        provider_id = send_email(receipt['payload'], key)
        if provider_id:
            client.table('radar_email_deliveries').update({'sent_at': datetime.now(timezone.utc).isoformat(),
                'provider_id': provider_id}).eq('id', key).execute()
            mark_as_notified(deal['hash_dedupe'])
