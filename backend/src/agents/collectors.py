import time
import random
from typing import List, Dict, Any
from fli.core.builders import build_flight_segments

# Constantes de destinos (IATA codes)
ORIGIN = "BUE" # Buenos Aires (EZE/AEP)
EUROPE_DESTINATIONS = ["MAD", "PAR", "LON"] # Madrid, Paris, London
ASIA_DESTINATIONS = ["TYO", "OSA"] # Tokyo, Osaka

# Constantes de fechas base (2027)
DEPARTURE_DATES = ["2027-04-17", "2027-04-18", "2027-04-19"]
RETURN_DATES = ["2027-04-26", "2027-04-27", "2027-04-28", "2027-04-29", "2027-04-30", "2027-05-01", "2027-05-02"]

def fetch_flights_with_retry(origin: str, dest: str, dep_date: str, ret_date: str, max_retries=3) -> List[Any]:
    """Helper to fetch flights with exponential backoff for rate limits."""
    for attempt in range(max_retries):
        try:
            # Llama a la librería fli para construir la búsqueda
            trip = build_flight_segments(origin, dest, dep_date, ret_date)
            # asumiendo que build_flight_segments devuelve algo que tiene un método .get_flights() o similar 
            # según la API de fli. Si trip es el objeto de búsqueda:
            # Nota: fli interna usa iteradores o métodos para obtener los vuelos. 
            # Como es reverse-engineering, acá simulamos la obtención en base a la doc de fli
            flights = trip.get_flights() 
            
            # Filtramos los que no tienen precio (Google a veces oculta el precio total)
            valid_flights = [f for f in flights if not getattr(f, 'price_unknown', False)]
            return valid_flights
            
        except Exception as e:
            error_msg = str(e)
            if "429" in error_msg or "403" in error_msg:
                # Rate limit
                sleep_time = (2 ** attempt) + random.random()
                print(f"Rate limited (429/403). Retrying in {sleep_time:.2f}s...")
                time.sleep(sleep_time)
            else:
                print(f"Error fetching {origin}-{dest}: {e}")
                break
    return []

def serialize_flight(flight: Any, dep_date: str, ret_date: str, origin: str, dest: str) -> Dict:
    """Extrae la información necesaria del objeto de vuelo de fli a un diccionario."""
    # Esto depende de la estructura real del objeto flight en fli.
    # Ajustar según corresponda.
    try:
        # Lógica heurística de moneda: si el precio > 20000, asumimos que viene en ARS y lo convertimos a USD.
        precio_raw = flight.price
        TIPO_CAMBIO_ARS = 1200 # Cotización aproximada
        if isinstance(precio_raw, (int, float)) and precio_raw > 20000:
            precio_usd = round(precio_raw / TIPO_CAMBIO_ARS)
            print(f"Normalizando moneda: {precio_raw} ARS -> {precio_usd} USD")
        else:
            precio_usd = round(precio_raw) if precio_raw else 0
            
        return {
            "ida_fecha": dep_date,
            "vuelta_fecha": ret_date,
            "ida_origen_destino": f"{origin}-{dest}",
            "vuelta_origen_destino": f"{dest}-{origin}",
            "precio_total_usd": precio_usd,
            "aerolinea": flight.airline, 
            "cantidad_escalas": flight.stops,
            "duracion_total_minutos": flight.duration,
            "link_reserva": flight.booking_token or "" 
        }
    except AttributeError as e:
        print(f"Error serializing flight: {e}")
        return {}

def collect_europe() -> List[Dict]:
    results = []
    print("Collecting flights for Europe...")
    for dest in EUROPE_DESTINATIONS:
        for dep in DEPARTURE_DATES:
            for ret in RETURN_DATES:
                flights = fetch_flights_with_retry(ORIGIN, dest, dep, ret)
                for f in flights:
                    data = serialize_flight(f, dep, ret, ORIGIN, dest)
                    if data:
                        results.append(data)
    return results

def collect_asia() -> List[Dict]:
    results = []
    print("Collecting flights for Asia...")
    for dest in ASIA_DESTINATIONS:
        for dep in DEPARTURE_DATES:
            for ret in RETURN_DATES:
                flights = fetch_flights_with_retry(ORIGIN, dest, dep, ret)
                for f in flights:
                    data = serialize_flight(f, dep, ret, ORIGIN, dest)
                    if data:
                        results.append(data)
    return results

def collect_lufthansa() -> List[Dict]:
    """Subagente capricho: filtra específicamente disponibilidad Lufthansa hacia Europa/Asia."""
    # Podemos reusar la lógica o simplemente tomar los resultados globales y filtrar.
    # Para optimizar requests, lo ideal sería que esto opere sobre los resultados ya obtenidos
    # o hacer búsquedas específicas si la API de fli permite filtrar aerolínea en el request.
    # Como LangGraph correrá en paralelo, hacemos las búsquedas (quizás con menos fechas para no agotar cuota).
    results = []
    print("Collecting flights for Lufthansa...")
    # Solo un subset para no hacer demasiados requests duplicados si no se puede filtrar en origen
    dest = "FRA" # Frankfurt (Hub principal)
    for dep in DEPARTURE_DATES[:1]: # Solo la primera fecha
        for ret in RETURN_DATES[:2]: # Solo dos fechas de retorno
            flights = fetch_flights_with_retry(ORIGIN, dest, dep, ret)
            for f in flights:
                if "lufthansa" in getattr(f, 'airline', '').lower():
                    data = serialize_flight(f, dep, ret, ORIGIN, dest)
                    if data:
                        results.append(data)
    return results
