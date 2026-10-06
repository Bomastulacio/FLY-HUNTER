"""Shared destination contract used by planning, validation and the web feed."""
import json
import re
import unicodedata
from pathlib import Path

CATALOG = json.loads((Path(__file__).resolve().parents[3] / 'shared' / 'radar-geography.json').read_text(encoding='utf-8'))
AIRPORTS = {code: dict(zip(CATALOG['airportFields'], values)) for code, values in CATALOG['airports'].items()}


def normalize_destination(value):
    return ''.join(c for c in unicodedata.normalize('NFD', str(value or '')) if not unicodedata.combining(c)).strip().upper()


COUNTRY_ALIASES = {normalize_destination(n): code for code, names in CATALOG['countryAliases'].items() for n in names}
CITIES, COUNTRIES = {}, {}
for code, airport in AIRPORTS.items():
    if airport['scheduled']:
        city = normalize_destination(airport['city'])
        if city:
            CITIES.setdefault(city, []).append(code)
        COUNTRIES.setdefault(airport['country'], []).append(code)
CITIES = {city: codes for city, codes in CITIES.items() if len({AIRPORTS[c]['country'] for c in codes}) == 1}


def origin_airports(value):
    result = []
    for part in re.split(r'[,/]', str(value or '')):
        key = normalize_destination(part)
        result.extend([key] if key in CATALOG['airports'] else CATALOG['metroAirports'].get(key, CITIES.get(key, [])))
    return list(dict.fromkeys(result))


def airport_country(code):
    return AIRPORTS.get(str(code).upper(), {}).get('country')


def destination_airports(target, purpose='display'):
    key = normalize_destination(target)
    global_airports = ([key] if key in CATALOG['airports'] else CATALOG['metroAirports'].get(key,
        COUNTRIES.get(COUNTRY_ALIASES.get(key), CITIES.get(key, []))))
    airports = list(CATALOG['metroAirports'].get(key, CATALOG['searchAirports'].get(key, global_airports)))
    if purpose == 'display':
        for label, values in CATALOG['displayAirports'].items():
            if normalize_destination(label) == key:
                airports.extend(values)
        for label, members in CATALOG['groups'].items():
            if normalize_destination(label) == key:
                for member in members:
                    airports.extend(destination_airports(member))
        airports.extend(global_airports)
    return list(dict.fromkeys(airports))


def radar_targets(radar):
    selected = radar.get('paises') or []
    return selected if selected and not any(normalize_destination(v) == 'CUALQUIERA' for v in selected) else [radar.get('destino', '')]
