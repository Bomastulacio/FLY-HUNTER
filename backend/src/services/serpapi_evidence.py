"""Strict evidence for one selected outbound and its provider-priced return.

No invented legs, no airport substitution, no independent one-way price sum.
"""
import math
from datetime import datetime


def direction(flight, origin, destination, departure_date):
    legs = flight.get('flights')
    if not isinstance(legs, list) or not 1 <= len(legs) <= 2:
        return None
    segments, airlines = [], []
    try:
        previous_arrival = None
        for leg in legs:
            start, end = leg['departure_airport'], leg['arrival_airport']
            dep = datetime.fromisoformat(start['time'])
            arr = datetime.fromisoformat(end['time'])
            # Provider times are airport-local, not UTC: don't subtract different zones.
            if not leg.get('airline') or not start.get('id') or not end.get('id'):
                return None
            if previous_arrival and (previous_arrival['id'] != start['id'] or dep < previous_arrival['time']):
                return None
            previous_arrival = {'id': end['id'], 'time': arr}
            airlines.append(leg['airline'])
            if leg.get('plane_and_crew_by'):
                airlines.append(str(leg['plane_and_crew_by']))
            segments.append({'origin': start['id'], 'destination': end['id'],
                'departure': start['time'], 'arrival': end['time'], 'flightNumber': leg.get('flight_number')})
        if (segments[0]['origin'] != origin or segments[-1]['destination'] != destination
                or segments[0]['departure'][:10] != departure_date):
            return None
        return {'segments': segments, 'airlines': list(dict.fromkeys(airlines)), 'stops': len(legs) - 1}
    except (KeyError, ValueError, TypeError, AttributeError):
        return None


def verified_roundtrip(outbound, returning, search, observed_at):
    ida = direction(outbound, search['origin'], search['dest'], search['dep_date'])
    vuelta = direction(returning, search['dest'], search['origin'], search['ret_date'])
    total = returning.get('price')
    if (not ida or not vuelta or returning.get('price_unknown') or returning.get('type') != 'Round trip'
            or isinstance(total, bool) or not isinstance(total, (int, float)) or not math.isfinite(total) or total <= 0):
        return None
    pax = search['passengers']
    durations = [outbound.get('total_duration'), returning.get('total_duration')]
    duration = sum(durations) if all(type(d) is int and d > 0 for d in durations) else None
    return {'ida_fecha': search['dep_date'], 'vuelta_fecha': search['ret_date'],
        'ida_origen_destino': f"{search['origin']}-{search['dest']}",
        'vuelta_origen_destino': f"{search['dest']}-{search['origin']}",
        'precio_original': total, 'moneda_original': 'USD', 'precio_total_usd': total,
        'precio_por_pasajero_usd': round(total / pax, 2), 'pasajeros': pax,
        'aerolinea': ' / '.join(dict.fromkeys(ida['airlines'] + vuelta['airlines'])),
        'cantidad_escalas': max(ida['stops'], vuelta['stops']), 'fuente': 'serpapi', 'created_at': observed_at,
        'duracion_total_minutos': duration,
        'detalle_cotizacion': {'priceBasis': 'party_total', 'passengersVerified': True,
            'itineraryScope': 'roundtrip', 'stopsPerDirection': [ida['stops'], vuelta['stops']],
            'observedAt': observed_at, 'priceVerified': True, 'queryVerified': True,
            'segments': {'outbound': ida['segments'], 'return': vuelta['segments']},
            'verificationMethod': 'serpapi_selected_return', 'bookingUrlVerified': False}}
