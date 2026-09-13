import os
from datetime import datetime, timezone
import requests
from typing import List, Dict, Any
import diskcache
from ..services.search_budget import reserve_paid_search

# Inicializar caché en el directorio del proyecto
cache_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), '.cache_vuelos')
flight_cache = diskcache.Cache(cache_dir)

SERPAPI_KEY = os.environ.get("SERPAPI_KEY", "")

def check_serpapi_quota() -> Dict[str, Any]:
    """
    Consulta el estado oficial de la cuenta en SerpApi (endpoint gratuito /account.json que no consume créditos).
    Verifica automáticamente los créditos restantes y detecta el restablecimiento de cuota el día 23 de septiembre.
    """
    if not SERPAPI_KEY:
        return {"available": False, "searches_left": 0, "reason": "Sin SERPAPI_KEY"}
        
    try:
        url = "https://serpapi.com/account.json"
        res = requests.get(url, params={"api_key": SERPAPI_KEY}, timeout=10)
        if res.status_code == 200:
            data = res.json()
            left = data.get("total_searches_left", data.get("plan_searches_left", 0))
            total = data.get("searches_per_month", 250)
            renew_date = data.get("renew_on", "fin de ciclo de facturación")
            
            if left <= 2:
                print(f"[SerpApi Guard] 🛑 Cuota casi agotada ({left} búsquedas restantes). Próxima renovación: {renew_date}. Preservando cuota.")
                return {"available": False, "searches_left": left, "renew_on": renew_date}
            else:
                print(f"[SerpApi Monitor] 🟢 ¡Cuota operativa! {left} de {total} búsquedas disponibles (Próxima renovación: {renew_date}).")
                return {"available": True, "searches_left": left, "renew_on": renew_date}
    except Exception as e:
        print(f"[SerpApi Monitor] Nota: No se pudo auditar cuota ({e}).")
        
    return {"available": False, "searches_left": 0, "reason": "Error al consultar estado"}

def fetch_serpapi_flights(origin: str, dest: str, dep_date: str, ret_date: str, adults: int = 1) -> List[Dict]:
    """Busca vuelos usando SerpApi (Google Flights) si hay cuota habilitada"""
    cache_key = ('quote_v2', origin, dest, dep_date, ret_date, adults, 'USD')
    cached = flight_cache.get(cache_key)
    if cached is not None:
        return cached
    if not SERPAPI_KEY or os.environ.get('SERPAPI_ENABLED', 'true').lower() != 'true':
        print("Warning: SERPAPI_KEY no encontrada. Omitiendo búsqueda.")
        return []
        
    # Verificar cuota en vivo antes de disparar la búsqueda paga
    quota = check_serpapi_quota()
    if not reserve_paid_search(flight_cache, quota):
        print("[SerpApi Guard] Búsqueda pospuesta por cuota o presupuesto de llamadas.")
        return []
        
    print(f"Buscando en SerpApi: {origin} -> {dest} ({dep_date} al {ret_date}) para {adults} adultos [Restantes: {quota.get('searches_left')}]")
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
        "sort_by": "2",
        "stops": "2",  # All airlines, at most one stop; AR is included, not a paid extra query.
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
        observed_at = datetime.now(timezone.utc).isoformat()
        pax = max(1, adults)
        for flight in raw_flights:
            # Obtener aerolinea del primer tramo
            airlines = [leg.get("airline", "Desconocida") for leg in flight.get("flights", [])]
            airline = ' / '.join(dict.fromkeys(airlines)) if airlines else "Múltiples"
            
            # Obtener escalas
            layovers = flight.get("layovers", [])
            stops = len(layovers) if layovers else max(0, len(flight.get("flights", [])) - 1)
            
            # Precio total devuelto por Google Flights para los pasajeros configurados
            precio_usd = flight.get("price", 0)
            if flight.get('price_unknown') or not isinstance(precio_usd, (int, float)) or precio_usd <= 0 or stops > 1 or not airlines:
                continue
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
                "fuente": "serpapi",
                "created_at": observed_at,
                "detalle_cotizacion": {"priceBasis": "party_total", "passengersVerified": True, "itineraryScope": "search_result", "observedAt": observed_at}
            })
            
        flight_cache.set(cache_key, parsed_flights, expire=21600)
        return parsed_flights
    except Exception as e:
        print(f"Error fetching from SerpApi: {type(e).__name__}")
        return []

def reusable_quote(deal: Dict) -> bool:
    """Retire pre-fix Google DOM quotes without deleting historical/saved flights."""
    if deal.get('fuente') != 'google_flights':
        return True
    evidence = deal.get('detalle_cotizacion') or {}
    return (evidence.get('googleParserVersion') == 2
            and evidence.get('priceVerified') is True
            and evidence.get('queryVerified') is True
            and evidence.get('searchView') == 'cheapest')


def collect_flights_for_search(search: Dict, check_cache_first: bool = True) -> List[Dict]:
    """
    Recolector enfocado en una búsqueda específica (origen, destino, fechas, pax).
    1. Si check_cache_first es True, revisa en Supabase si Playwright ya guardó vuelos frescos ($0 cost).
       Exige coincidencia estricta de origen, destino, fechas y cantidad de pasajeros.
    2. Si no hay vuelos en caché o se requiere búsqueda fresca/refinada, consulta SerpApi cuidando la cuota.
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
            # Filtrar con coincidencia estricta: ruta, fechas exactas y misma cantidad de pasajeros
            matching = [
                d for d in (recent or [])
                if reusable_quote(d) and d.get("ida_origen_destino") == f"{origin}-{dest}"
                and d.get("vuelta_origen_destino") == f"{dest}-{origin}"
                and str(d.get("ida_fecha")) == str(dep_date)
                and str(d.get("vuelta_fecha")) == str(ret_date)
                and int(d.get("pasajeros", 1) or 1) == adults
            ]
            if matching:
                print(f"[Recolector Híbrido] ⚡ Usando {len(matching)} vuelos frescos de Playwright en Supabase para {dest} ({adults} pax, $0 cuota).")
                results = []
                for d in matching:
                    pax = int(d.get("pasajeros", adults) or adults)
                    precio_total = float(d.get("precio_total_usd", 0) or 0)
                    precio_unit = float(d.get("precio_por_pasajero_usd") or (round(precio_total / pax, 2) if pax > 0 else precio_total))
                    results.append({
                        "ida_fecha": d.get("ida_fecha", dep_date),
                        "vuelta_fecha": d.get("vuelta_fecha", ret_date),
                        "ida_origen_destino": d.get("ida_origen_destino", f"{origin}-{dest}"),
                        "vuelta_origen_destino": d.get("vuelta_origen_destino", f"{dest}-{origin}"),
                        "precio_original": d.get("precio_original", precio_total),
                        "moneda_original": d.get("moneda_original", "USD"),
                        "precio_total_usd": precio_total,
                        "pasajeros": pax,
                        "precio_por_pasajero_usd": precio_unit,
                        "aerolinea": d.get("aerolinea", "Aerolínea"),
                        "cantidad_escalas": d.get("cantidad_escalas"),
                        "duracion_total_minutos": int(d.get("duracion_total_minutos", 720) or 720),
                        "link_reserva": d.get("link_reserva", ""),
                        "fuente": d.get("fuente", "agent_playwright"),
                        "hash_dedupe": d.get("hash_dedupe"),
                        "notificado": d.get("notificado", False),
                        "created_at": d.get("created_at"),
                        "detalle_cotizacion": d.get("detalle_cotizacion")
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
       Si existen, los reutiliza a costo $0 y preserva al 100% la cuota de SerpApi.
    2. Si no hay vuelos frescos en Supabase, realiza la recolección estratégica con SerpApi.
    """
    # 1. Intentar reutilizar vuelos frescos del Agente Playwright (Costo $0)
    try:
        from ..services.db import get_recent_flight_deals
        recent_deals = [d for d in (get_recent_flight_deals(days=1) or []) if reusable_quote(d)]
        if recent_deals and len(recent_deals) > 0:
            print(f"[Recolector Híbrido] ⚡ Se detectaron {len(recent_deals)} vuelos frescos guardados por el Agente Playwright en Supabase.")
            print(f"[Recolector Híbrido] 🛡️ Cuota de SerpApi preservada intacta.")
            
            raw_flights = []
            for d in recent_deals:
                pax = int(d.get("pasajeros", 1) or 1)
                precio_total = float(d.get("precio_total_usd", 0) or 0)
                precio_unit = float(d.get("precio_por_pasajero_usd") or (round(precio_total / pax, 2) if pax > 0 else precio_total))
                raw_flights.append({
                    "ida_fecha": d.get("ida_fecha"),
                    "vuelta_fecha": d.get("vuelta_fecha"),
                    "ida_origen_destino": d.get("ida_origen_destino"),
                    "vuelta_origen_destino": d.get("vuelta_origen_destino"),
                    "precio_original": d.get("precio_original", precio_total),
                    "moneda_original": d.get("moneda_original", "USD"),
                    "precio_total_usd": precio_total,
                    "pasajeros": pax,
                    "precio_por_pasajero_usd": precio_unit,
                    "aerolinea": d.get("aerolinea", "Aerolínea"),
                    "cantidad_escalas": int(d.get("cantidad_escalas", 0) or 0),
                    "duracion_total_minutos": int(d.get("duracion_total_minutos", 720) or 720),
                    "link_reserva": d.get("link_reserva", ""),
                    "fuente": d.get("fuente", "agent_playwright"),
                    "detalle_cotizacion": d.get("detalle_cotizacion"),
                    "created_at": d.get("created_at")
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
