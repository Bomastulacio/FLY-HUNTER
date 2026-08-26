import os
import random
import requests
import datetime
from typing import List, Dict, Any
import diskcache

# Inicializar caché en el directorio del proyecto
cache_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), '.cache_vuelos')
flight_cache = diskcache.Cache(cache_dir)

# Constantes de destinos (IATA codes)
ORIGIN = "EZE" # Buenos Aires (EZE/AEP)
EUROPE_DESTINATIONS = ["MAD", "CDG", "LHR", "BER"] # Madrid, Paris (CDG), London (LHR), Berlin (BER)
ASIA_DESTINATIONS = ["NRT", "KIX"] # Tokyo (NRT), Osaka (KIX)

# Constantes de fechas base (2027)
DEPARTURE_DATES = ["2027-04-17", "2027-04-18", "2027-04-19"]
RETURN_DATES = ["2027-04-26", "2027-04-27", "2027-04-28", "2027-04-29", "2027-04-30", "2027-05-01", "2027-05-02"]

SERPAPI_KEY = os.environ.get("SERPAPI_KEY", "")

@flight_cache.memoize(expire=43200) # Expira en 12 horas
def fetch_serpapi_flights(origin: str, dest: str, dep_date: str, ret_date: str) -> List[Dict]:
    """Busca vuelos usando SerpApi (Google Flights)"""
    if not SERPAPI_KEY:
        print("Warning: SERPAPI_KEY no encontrada. Omitiendo búsqueda.")
        return []
        
    print(f"Buscando en SerpApi: {origin} -> {dest} ({dep_date} al {ret_date})")
    url = "https://serpapi.com/search.json"
    params = {
        "engine": "google_flights",
        "departure_id": origin,
        "arrival_id": dest,
        "outbound_date": dep_date,
        "return_date": ret_date,
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
        for flight in raw_flights:
            # Obtener aerolinea del primer tramo
            airlines = [leg.get("airline", "Desconocida") for leg in flight.get("flights", [])]
            airline = airlines[0] if airlines else "Múltiples"
            
            # Obtener escalas
            layovers = flight.get("layovers", [])
            stops = len(layovers) if layovers else max(0, len(flight.get("flights", [])) - 1)
            
            # Precio base (1 pasajero) y lo multiplicamos por 2 para el presupuesto de pareja
            precio_usd = flight.get("price", 0) * 2
            
            parsed_flights.append({
                "ida_fecha": dep_date,
                "vuelta_fecha": ret_date,
                "ida_origen_destino": f"{origin}-{dest}",
                "vuelta_origen_destino": f"{dest}-{origin}",
                "precio_original": precio_usd,
                "moneda_original": "USD",
                "precio_total_usd": precio_usd,
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

def get_daily_dates() -> tuple[str, str]:
    day_of_year = datetime.datetime.now().timetuple().tm_yday
    dep = DEPARTURE_DATES[day_of_year % len(DEPARTURE_DATES)]
    ret = RETURN_DATES[day_of_year % len(RETURN_DATES)]
    return dep, ret

def collect_europe() -> List[Dict]:
    results = []
    dep, ret = get_daily_dates()
    for dest in EUROPE_DESTINATIONS:
        results.extend(fetch_serpapi_flights(ORIGIN, dest, dep, ret))
    return results

def collect_asia() -> List[Dict]:
    results = []
    dep, ret = get_daily_dates()
    for dest in ASIA_DESTINATIONS:
        results.extend(fetch_serpapi_flights(ORIGIN, dest, dep, ret))
    return results

def collect_lufthansa() -> List[Dict]:
    results = []
    dep, ret = get_daily_dates()
    for dest in EUROPE_DESTINATIONS:
        flights = fetch_serpapi_flights(ORIGIN, dest, dep, ret)
        lufthansa_deals = [f for f in flights if "lufthansa" in f.get("aerolinea", "").lower()]
        results.extend(lufthansa_deals)
    return results
