"""Shared destination contract used by planning, validation and the web feed."""
import json
import re
import unicodedata
from pathlib import Path

CATALOG = json.loads((Path(__file__).resolve().parents[3] / 'shared' / 'radar-geography.json').read_text(encoding='utf-8'))


def normalize_destination(value):
    return ''.join(c for c in unicodedata.normalize('NFD', str(value or '')) if not unicodedata.combining(c)).strip().upper()


def destination_airports(target, purpose='display'):
    key = normalize_destination(target)
    airports = list(CATALOG['searchAirports'].get(key, []))
    if purpose == 'display':
        for label, values in CATALOG['displayAirports'].items():
            if normalize_destination(label) == key:
                airports.extend(values)
        for label, members in CATALOG['groups'].items():
            if normalize_destination(label) == key:
                for member in members:
                    airports.extend(destination_airports(member))
    if re.fullmatch('[A-Z]{3}', key):
        airports.append(key)
    return list(dict.fromkeys(airports))


def radar_targets(radar):
    selected = radar.get('paises') or []
    return selected if selected and not any(normalize_destination(v) == 'CUALQUIERA' for v in selected) else [radar.get('destino', '')]
