from typing import List, Dict

EUROPE_DESTINATIONS = ["MAD", "CDG", "LHR", "BER", "FCO", "AMS", "LIS", "ZRH", "ATH"]
ASIA_DESTINATIONS = ["NRT", "HND", "KIX", "ICN", "BKK", "SIN", "DXB"]
OCEANIA_DESTINATIONS = ["SYD", "MEL", "AKL"]

def sanitize_flights(raw_flights: List[Dict]) -> List[Dict]:
    """
    Sanitizador: Filtra (fail-fast) combinaciones de vuelos inútiles o erróneas 
    devueltas por la API antes de que lleguen al Analista.
    """
    clean_flights = []
    
    for f in raw_flights:
        precio = f.get("precio_total_usd", 0)
        escalas = f.get("cantidad_escalas", 0)
        duracion = f.get("duracion_total_minutos", 0)
        ida_od = f.get("ida_origen_destino", "")
        
        # 1. Regla: Precio válido (evitar glitches de la API que devuelven 0)
        if precio <= 0:
            continue
            
        # 2. Regla Crítica: Tolerancia Cero en escalas > 1
        if escalas > 1:
            continue
            
        # 3. Regla: Duración lógica según región
        dest = ida_od.split("-")[1] if "-" in ida_od else ""
        
        if dest in OCEANIA_DESTINATIONS:
            max_duracion = 3000 # 50 horas
        elif dest in ASIA_DESTINATIONS:
            max_duracion = 2400 # 40 horas
        else:
            # Europa, América, Caribe u otros (32 horas)
            max_duracion = 1920 # 32 horas
            
        if duracion > max_duracion:
            continue
            
        clean_flights.append(f)
        
    descartados = len(raw_flights) - len(clean_flights)
    print(f"--- Sanitizador: {descartados} vuelos basura descartados (limpios: {len(clean_flights)}) ---")
    return clean_flights
