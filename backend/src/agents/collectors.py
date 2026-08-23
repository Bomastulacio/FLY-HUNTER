import os
import random
import requests
from typing import List, Dict, Any

# Constantes de destinos (IATA codes)
ORIGIN = "EZE" # Buenos Aires (EZE/AEP)
EUROPE_DESTINATIONS = ["MAD", "CDG", "LHR"] # Madrid, Paris (CDG), London (LHR)
ASIA_DESTINATIONS = ["NRT", "KIX"] # Tokyo (NRT), Osaka (KIX)

# Constantes de fechas base (2027)
DEPARTURE_DATES = ["2027-04-17", "2027-04-18", "2027-04-19"]
RETURN_DATES = ["2027-04-26", "2027-04-27", "2027-04-28", "2027-04-29", "2027-04-30", "2027-05-01", "2027-05-02"]

SERPAPI_KEY = os.environ.get("SERPAPI_KEY", "")

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
        
        # Juntamos 'best_flights' y 'other_flights'
        raw_flights = data.get("best_flights", []) + data.get("other_flights", [])
        
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
            
            # Precio
            precio_usd = flight.get("price", 0)
            
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

def collect_europe() -> List[Dict]:
    results = []
    for dest in EUROPE_DESTINATIONS:
        dep = random.choice(DEPARTURE_DATES)
        ret = random.choice(RETURN_DATES)
        results.extend(fetch_serpapi_flights(ORIGIN, dest, dep, ret))
    return results

def collect_asia() -> List[Dict]:
    results = []
    for dest in ASIA_DESTINATIONS:
        dep = random.choice(DEPARTURE_DATES)
        ret = random.choice(RETURN_DATES)
        results.extend(fetch_serpapi_flights(ORIGIN, dest, dep, ret))
    return results

def collect_lufthansa() -> List[Dict]:
    dest = "FRA"
    dep = random.choice(DEPARTURE_DATES)
    ret = random.choice(RETURN_DATES)
    
    flights = fetch_serpapi_flights(ORIGIN, dest, dep, ret)
    lufthansa_deals = [f for f in flights if "lufthansa" in f.get("aerolinea", "").lower()]
    return lufthansa_deals
