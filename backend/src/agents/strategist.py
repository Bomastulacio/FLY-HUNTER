import os
import datetime
from typing import Dict, Any, List
from ..services.db import get_active_search_alerts

# Mapeo Geográfico Avanzado (Zonas, Países y Ciudades)
GEO_MAP = {
    # Zonas Generales
    "Norteamérica": ["JFK", "MIA", "LAX", "YYZ", "MEX"],
    "Latinoamérica": ["GRU", "BOG", "LIM", "SCL", "GIG", "MVD"],
    "Caribe": ["CUN", "PUJ", "HAV", "SJO", "SJU"],
    "Europa": ["MAD", "CDG", "LHR", "BER", "FCO", "AMS", "LIS", "ZRH", "ATH"],
    "Asia": ["NRT", "HND", "KIX", "ICN", "BKK", "SIN", "DXB"],
    "Oceanía": ["SYD", "MEL", "AKL"],
    "Cualquiera": ["MAD", "MIA", "NRT", "CUN"], # Destinos globales por defecto

    # Países Específicos
    "Estados Unidos": ["JFK", "MIA", "LAX", "ORD"],
    "Canadá": ["YYZ", "YVR"],
    "México": ["MEX", "CUN"],
    "Brasil": ["GRU", "GIG"],
    "Chile": ["SCL"],
    "Colombia": ["BOG", "MDE"],
    "Perú": ["LIM"],
    "Uruguay": ["MVD"],
    "República Dominicana": ["PUJ", "SDQ"],
    "Cuba": ["HAV"],
    "Costa Rica": ["SJO"],
    "Puerto Rico": ["SJU"],
    "España": ["MAD", "BCN"],
    "Francia": ["CDG", "ORY"],
    "Italia": ["FCO", "MXP"],
    "Reino Unido": ["LHR", "LGW"],
    "Alemania": ["BER", "FRA", "MUC"],
    "Portugal": ["LIS", "OPO"],
    "Países Bajos": ["AMS"],
    "Suiza": ["ZRH", "GVA"],
    "Grecia": ["ATH"],
    "Japón": ["NRT", "HND", "KIX"],
    "Tailandia": ["BKK", "HKT"],
    "Corea del Sur": ["ICN"],
    "Emiratos Árabes": ["DXB"],
    "Australia": ["SYD", "MEL"],
    "Nueva Zelanda": ["AKL"],

    # Ciudades / Monitoreo Ultra-específico
    "Miami": ["MIA"],
    "Nueva York": ["JFK", "EWR"],
    "Tokio": ["NRT", "HND"],
    "Cancún": ["CUN"],
    "París": ["CDG", "ORY"],
    "Río de Janeiro": ["GIG"]
}

# Datos de prueba para el modo manual sin consumir API
MOCK_FLIGHTS = [
    {
        "ida_fecha": "2027-04-17",
        "vuelta_fecha": "2027-04-26",
        "ida_origen_destino": "EZE-MAD",
        "vuelta_origen_destino": "MAD-EZE",
        "precio_original": 1200.0,
        "moneda_original": "USD",
        "precio_total_usd": 1200.0,
        "aerolinea": "Lufthansa",
        "cantidad_escalas": 1,
        "duracion_total_minutos": 780,
        "link_reserva": "https://google.com/flights",
        "fuente": "mock"
    }
]

def define_daily_mission() -> Dict[str, Any]:
    """Reuse the scraper's exact plan, or rotate a bounded deterministic plan."""
    import json
    import re
    from pathlib import Path
    from .collectors import flight_cache
    if os.environ.get('TEST_MODE', '').lower() == 'true':
        return {'use_mock': True, 'mock_data': MOCK_FLIGHTS, 'searches': [], 'alerts_context': []}
    alerts = get_active_search_alerts()
    if not alerts:
        return {'searches': [], 'alerts_context': [], 'use_mock': False}
    artifact = os.environ.get('FLIGHT_SEARCH_PLAN_PATH')
    if artifact:
        # Missing/malformed artifact is an error, never permission to spend on another plan.
        data = json.loads(Path(artifact).read_text(encoding='utf-8'))
        if data.get('version') != 1 or not isinstance(data.get('searches'), list):
            raise ValueError('Invalid search plan artifact')
        active = {str(a['id']): a for a in alerts}
        searches, seen = [], set()
        for s in data['searches']:
            alert = active.get(str(s.get('alert_id')))
            if not alert:
                continue
            # Revalidate against the current alert; a user may have edited it since scraping.
            origins = [v.strip() for v in re.split(r'[,/]', alert['origen'])]
            targets = set()
            countries = alert.get('paises') or [alert.get('destino')]
            if 'Cualquiera' in countries:
                countries = [alert.get('destino')]
            for country in countries:
                targets.update(GEO_MAP.get(country, [country]))
            if (s.get('origin') not in origins or s.get('dest') not in targets
                    or s.get('passengers') != int(alert.get('pasajeros') or 1)
                    or not (alert['fecha_ida_min'] <= s.get('dep_date', '') <= (alert.get('fecha_ida_max') or alert['fecha_ida_min']))
                    or not (alert['fecha_vuelta_min'] <= s.get('ret_date', '') <= (alert.get('fecha_vuelta_max') or alert['fecha_vuelta_min']))):
                continue
            key = tuple(s.get(k) for k in ('alert_id', 'origin', 'dest', 'dep_date', 'ret_date', 'passengers'))
            if key not in seen:
                seen.add(key)
                searches.append(s)
        return {'use_mock': False, 'searches': searches, 'alerts_context': alerts}

    candidates = []
    for alert in sorted(alerts, key=lambda a: str(a.get('id', ''))):
        try:
            dep_min = datetime.date.fromisoformat(alert['fecha_ida_min'])
            dep_max = datetime.date.fromisoformat(alert.get('fecha_ida_max') or alert['fecha_ida_min'])
            ret_min = datetime.date.fromisoformat(alert['fecha_vuelta_min'])
            ret_max = datetime.date.fromisoformat(alert.get('fecha_vuelta_max') or alert['fecha_vuelta_min'])
            if not (0 <= (dep_max - dep_min).days <= 366 and 0 <= (ret_max - ret_min).days <= 366):
                continue
            targets = set()
            countries = alert.get('paises') or [alert['destino']]
            if 'Cualquiera' in countries:
                countries = [alert['destino']]
            for country in countries:
                targets.update(GEO_MAP.get(country, [country]))
            for di in range((dep_max - dep_min).days + 1):
                dep = dep_min + datetime.timedelta(days=di)
                if dep < datetime.date.today():
                    continue
                for ri in range((ret_max - ret_min).days + 1):
                    ret = ret_min + datetime.timedelta(days=ri)
                    if ret <= dep:
                        continue
                    for origin in sorted(set(re.split(r'[,/]', alert['origen']))):
                        for dest in sorted(targets):
                            if not re.fullmatch(r'[A-Z]{3}', origin.strip()) or not re.fullmatch(r'[A-Z]{3}', dest):
                                continue
                            candidates.append({'alert_id': alert['id'], 'origin': origin.strip(), 'dest': dest,
                                'dep_date': dep.isoformat(), 'ret_date': ret.isoformat(), 'passengers': int(alert.get('pasajeros') or 1)})
        except (ValueError, KeyError, TypeError):
            continue
    count = min(4, len(candidates))
    with flight_cache.transact():
        cursor = flight_cache.get('planner_cursor_v2', 0)
        searches = [candidates[(cursor + i) % len(candidates)] for i in range(count)]
        flight_cache.set('planner_cursor_v2', cursor + count)
    return {'use_mock': False, 'searches': searches, 'alerts_context': alerts}
