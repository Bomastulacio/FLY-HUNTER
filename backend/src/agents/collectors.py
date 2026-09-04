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

def collect_flights_for_search(search: Dict, check_cache_first: bool = True) -> List[Dict]:
    """
    Recolector enfocado en una búsqueda específica (origen, destino, fechas, pax).
    1. Si check_cache_first es True, revisa en Supabase si Playwright ya guardó vuelos frescos ($0 cost).
    2. Si no hay vuelos en caché o se requiere búsqueda fresca/refinada, consulta SerpApi cuidando la cuota (250/mes).
    """
    origin = search.get("origin")
    dest = search.get("dest")
    dep_date = search.get("dep_date")
    ret_date = search.get("ret_date")
    adults = int(search.get("passengers", 1) or 1)
    
    if check_cache_first:
        try:
            from ..services.db import get_recent_flight_deals
            recent = get_recent_flight_deals(days=1)
            # Filtrar si coinciden ruta y fechas
            matching = [
                d for d in (recent or [])
                if dest in d.get("ida_origen_destino", "") or dest in d.get("vuelta_origen_destino", "")
            ]
            if matching:
                print(f"[Recolector Híbrido] ⚡ Usando {len(matching)} vuelos frescos de Playwright en Supabase para {dest} ($0 cuota).")
                results = []
                for d in matching:
                    pax = int(d.get("pasajeros", adults) or adults)
                    precio_total = float(d.get("precio_total_usd", 0) or 0)
                    results.append({
                        "ida_fecha": d.get("ida_fecha", dep_date),
                        "vuelta_fecha": d.get("vuelta_fecha", ret_date),
                        "ida_origen_destino": d.get("ida_origen_destino", f"{origin}-{dest}"),
                        "vuelta_origen_destino": d.get("vuelta_origen_destino", f"{dest}-{origin}"),
                        "precio_original": precio_total,
                        "moneda_original": "USD",
                        "precio_total_usd": precio_total,
                        "pasajeros": pax,
                        "precio_por_pasajero_usd": round(precio_total / pax, 2) if pax > 0 else precio_total,
                        "aerolinea": d.get("aerolinea", "Aerolínea"),
                        "cantidad_escalas": int(d.get("cantidad_escalas", 0) or 0),
                        "duracion_total_minutos": int(d.get("duracion_total_minutos", 720) or 720),
                        "link_reserva": d.get("link_reserva", ""),
                        "fuente": d.get("fuente", "agent_playwright")
                    })
                return results
        except Exception as e:
            print(f"[Recolector Híbrido] Caché omitida ({e}). Procediendo con SerpApi.")

    if all([origin, dest, dep_date, ret_date]):
        return fetch_serpapi_flights(origin, dest, dep_date, ret_date, adults=adults)
    return []

def collect_dynamic_flights(mission: Dict) -> List[Dict]:
    """
    Recolector Híbrido Inteligente:
    1. Primero revisa si ya existen vuelos frescos guardados por el Agente Playwright en Supabase (últimas 12 horas).
       Si existen, los reutiliza a costo $0 y preserva al 100% la cuota de SerpApi (250 búsquedas/mes).
    2. Si no hay vuelos frescos en Supabase, realiza la recolección estratégica con SerpApi (fallback infalible).
    """
    # 1. Intentar reutilizar vuelos frescos del Agente Playwright (Costo $0)
    try:
        from ..services.db import get_recent_flight_deals
        recent_deals = get_recent_flight_deals(days=1)
        if recent_deals and len(recent_deals) > 0:
            print(f"[Recolector Híbrido] ⚡ Se detectaron {len(recent_deals)} vuelos frescos guardados por el Agente Playwright en Supabase.")
            print(f"[Recolector Híbrido] 🛡️ Cuota de SerpApi preservada intacta (250 créditos/mes).")
            
            raw_flights = []
            for d in recent_deals:
                pax = int(d.get("pasajeros", 2) or 2)
                precio_total = float(d.get("precio_total_usd", 0) or 0)
                raw_flights.append({
                    "ida_fecha": d.get("ida_fecha"),
                    "vuelta_fecha": d.get("vuelta_fecha"),
                    "ida_origen_destino": d.get("ida_origen_destino"),
                    "vuelta_origen_destino": d.get("vuelta_origen_destino"),
                    "precio_original": precio_total,
                    "moneda_original": "USD",
                    "precio_total_usd": precio_total,
                    "pasajeros": pax,
                    "precio_por_pasajero_usd": round(precio_total / pax, 2) if pax > 0 else precio_total,
                    "aerolinea": d.get("aerolinea", "Aerolínea"),
                    "cantidad_escalas": int(d.get("cantidad_escalas", 0) or 0),
                    "duracion_total_minutos": int(d.get("duracion_total_minutos", 720) or 720),
                    "link_reserva": d.get("link_reserva", ""),
                    "fuente": d.get("fuente", "agent_playwright")
                })
            return raw_flights
    except Exception as e:
        print(f"[Recolector Híbrido] Nota: No se pudo leer Supabase ({e}). Procediendo con SerpApi.")

    # 2. Fallback: Búsqueda dinámica con SerpApi
    print("[Recolector Híbrido] 🌐 Consultando SerpApi como motor de búsqueda...")
    results = []
    searches = mission.get("searches", [])
    
    if not searches:
        print("Recolector: No hay búsquedas asignadas en la misión.")
        return []
        
    for search in searches:
        flights = collect_flights_for_search(search, check_cache_first=False)
        results.extend(flights)
            
    return results

