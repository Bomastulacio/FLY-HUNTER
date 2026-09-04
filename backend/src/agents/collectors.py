import os
import requests
from typing import List, Dict, Any
import diskcache

# Inicializar caché en el directorio del proyecto
cache_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), '.cache_vuelos')
flight_cache = diskcache.Cache(cache_dir)

SERPAPI_KEY = os.environ.get("SERPAPI_KEY", "")

@flight_cache.memoize(expire=43200) # Expira en 12 horas
def fetch_serpapi_flights(origin: str, dest: str, dep_date: str, ret_date: str, adults: int = 1) -> List[Dict]:
    """Busca vuelos usando SerpApi (Google Flights)"""
    if not SERPAPI_KEY:
        print("Warning: SERPAPI_KEY no encontrada. Omitiendo búsqueda.")
        return []
        
    print(f"Buscando en SerpApi: {origin} -> {dest} ({dep_date} al {ret_date}) para {adults} adultos")
    url = "https://serpapi.com/search.json"
    params = {
        "engine": "google_flights",
        "departure_id": origin,
        "arrival_id": dest,
        "outbound_date": dep_date,
        "return_date": ret_date,
        "adults": adults,
        "currency": "USD",
        "type": "1", # Ida y vuelta
        "api_key": SERPAPI_KEY
    }
    
    try:
        response = requests.get(url, params=params, timeout=30)
        response.raise_for_status()
        data = response.json()
        
        if "error" in data:
            print(f"SerpApi JSON Error: {data['error']}")
            
        # Juntamos 'best_flights' y 'other_flights'
        raw_flights = data.get("best_flights", []) + data.get("other_flights", [])
        
        if not raw_flights:
            print(f"Warning: SerpApi devolvió 0 vuelos para {origin}-{dest}.")
            
        # Link para reservar
        search_link = data.get("search_metadata", {}).get("google_flights_url", "https://google.com/travel/flights")
        
        parsed_flights = []
        pax = max(1, adults)
        for flight in raw_flights:
            # Obtener aerolinea del primer tramo
            airlines = [leg.get("airline", "Desconocida") for leg in flight.get("flights", [])]
            airline = airlines[0] if airlines else "Múltiples"
            
            # Obtener escalas
            layovers = flight.get("layovers", [])
            stops = len(layovers) if layovers else max(0, len(flight.get("flights", [])) - 1)
            
            # Precio total devuelto por Google Flights para los pasajeros configurados
            precio_usd = flight.get("price", 0)
            precio_unitario = round(precio_usd / pax, 2) if precio_usd else 0.0
            
            parsed_flights.append({
                "ida_fecha": dep_date,
                "vuelta_fecha": ret_date,
                "ida_origen_destino": f"{origin}-{dest}",
                "vuelta_origen_destino": f"{dest}-{origin}",
                "precio_original": precio_usd,
                "moneda_original": "USD",
                "precio_total_usd": precio_usd,
                "pasajeros": pax,
                "precio_por_pasajero_usd": precio_unitario,
                "aerolinea": airline,
                "cantidad_escalas": stops,
                "duracion_total_minutos": flight.get("total_duration", 0),
                "link_reserva": search_link,
                "fuente": "serpapi"
            })
            
        return parsed_flights
    except Exception as e:
        print(f"Error fetching from SerpApi: {e}")
        return []

def collect_dynamic_flights(mission: Dict) -> List[Dict]:
    """
    Recolector Genérico: Ejecuta las búsquedas dinámicas definidas por el Estratega.
    """
    results = []
    searches = mission.get("searches", [])
    
    if not searches:
        print("Recolector: No hay búsquedas asignadas en la misión.")
        return []
        
    for search in searches:
        origin = search.get("origin")
        dest = search.get("dest")
        dep_date = search.get("dep_date")
        ret_date = search.get("ret_date")
        adults = int(search.get("passengers", 1) or 1)
        
        if all([origin, dest, dep_date, ret_date]):
            flights = fetch_serpapi_flights(origin, dest, dep_date, ret_date, adults=adults)
            results.extend(flights)
            
    return results
