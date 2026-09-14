import math
from typing import List, Dict

def sanitize_flights(raw_flights: List[Dict]) -> List[Dict]:
    """
    Sanitizador: Filtra (fail-fast) combinaciones de vuelos inútiles o erróneas 
    devueltas por la API antes de que lleguen al Analista.
    """
    clean_flights = []
    
    for f in raw_flights:
        precio = f.get("precio_total_usd")
        escalas = f.get("cantidad_escalas")
        try:
            if (f.get("price_unknown") not in (None, False)
                    or isinstance(precio, bool) or isinstance(escalas, bool)
                    or not math.isfinite(float(precio)) or float(precio) <= 0
                    or not math.isfinite(float(escalas)) or float(escalas) not in (0, 1)):
                continue
        except (TypeError, ValueError, OverflowError):
            continue

        # A long connection can still satisfy the radar. No duration limit is
        # configured by the user, and sources may measure a leg or both legs.
        # Do not silently remove valid quotes using an arbitrary regional cap.
        clean_flights.append(f)
        
    descartados = len(raw_flights) - len(clean_flights)
    print(f"--- Sanitizador: {descartados} vuelos basura descartados (limpios: {len(clean_flights)}) ---")
    return clean_flights
