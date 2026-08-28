import os
import datetime
from typing import Dict, Any, List
from ..services.db import get_active_search_alerts

# Mapeo Geográfico Avanzado (Zonas, Países y Ciudades)
GEO_MAP = {
    # Zonas Generales
    "Norteamérica": ["JFK", "MIA", "LAX", "YYZ", "MEX"],
    "Latinoamérica": ["GRU", "BOG", "LIM", "SCL", "GIG", "MVD"],
    "Caribe": ["CUN", "PUJ", "HAV", "SJO", "SJU"],
    "Europa": ["MAD", "CDG", "LHR", "BER", "FCO", "AMS", "LIS", "ZRH", "ATH"],
    "Asia": ["NRT", "HND", "KIX", "ICN", "BKK", "SIN", "DXB"],
    "Oceanía": ["SYD", "MEL", "AKL"],
    "Cualquiera": ["MAD", "MIA", "NRT", "CUN"], # Destinos globales por defecto

    # Países Específicos
    "Estados Unidos": ["JFK", "MIA", "LAX", "ORD"],
    "Canadá": ["YYZ", "YVR"],
    "México": ["MEX", "CUN"],
    "Brasil": ["GRU", "GIG"],
    "Chile": ["SCL"],
    "Colombia": ["BOG", "MDE"],
    "Perú": ["LIM"],
    "Uruguay": ["MVD"],
    "República Dominicana": ["PUJ", "SDQ"],
    "Cuba": ["HAV"],
    "Costa Rica": ["SJO"],
    "Puerto Rico": ["SJU"],
    "España": ["MAD", "BCN"],
    "Francia": ["CDG", "ORY"],
    "Italia": ["FCO", "MXP"],
    "Reino Unido": ["LHR", "LGW"],
    "Alemania": ["BER", "FRA", "MUC"],
    "Portugal": ["LIS", "OPO"],
    "Países Bajos": ["AMS"],
    "Suiza": ["ZRH", "GVA"],
    "Grecia": ["ATH"],
    "Japón": ["NRT", "HND", "KIX"],
    "Tailandia": ["BKK", "HKT"],
    "Corea del Sur": ["ICN"],
    "Emiratos Árabes": ["DXB"],
    "Australia": ["SYD", "MEL"],
    "Nueva Zelanda": ["AKL"],

    # Ciudades / Monitoreo Ultra-específico
    "Miami": ["MIA"],
    "Nueva York": ["JFK", "EWR"],
    "Tokio": ["NRT", "HND"],
    "Cancún": ["CUN"],
    "París": ["CDG", "ORY"],
    "Río de Janeiro": ["GIG"]
}

# Datos de prueba para el modo manual sin consumir API
MOCK_FLIGHTS = [
    {
        "ida_fecha": "2027-04-17",
        "vuelta_fecha": "2027-04-26",
        "ida_origen_destino": "EZE-MAD",
        "vuelta_origen_destino": "MAD-EZE",
        "precio_original": 1200.0,
        "moneda_original": "USD",
        "precio_total_usd": 1200.0,
        "aerolinea": "Lufthansa",
        "cantidad_escalas": 1,
        "duracion_total_minutos": 780,
        "link_reserva": "https://google.com/flights",
        "fuente": "mock"
    }
]

def define_daily_mission() -> Dict[str, Any]:
    """
    Estratega: Lee las alertas de los usuarios, mapea los destinos, 
    elimina duplicados y devuelve las búsquedas optimizadas respetando la cuota.
    """
    if os.environ.get("TEST_MODE", "").lower() == "true":
        print("--- ESTRATEGA: MODO TEST ACTIVADO. Usando datos Mock ---")
        return {
            "use_mock": True,
            "mock_data": MOCK_FLIGHTS,
            "searches": []
        }
        
    print("--- ESTRATEGA: Analizando alertas de usuarios ---")
    alerts = get_active_search_alerts()
    
    # Defaults in case of missing dates (for fallback MVP)
    default_dep = "2027-04-17"
    default_ret = "2027-04-26"
    
    if not alerts:
        print("No hay alertas activas o hubo un error. Usando misión de fallback por defecto (Europa).")
        alerts = [
            {
                "origen": "EZE",
                "destino": "Europa",
                "paises": ["España", "Francia", "Reino Unido", "Alemania"],
                "fecha_ida_min": default_dep,
                "fecha_vuelta_min": default_ret
            }
        ]
        
    unique_searches = set()
    
    for alert in alerts:
        # Obtener origen (Si es EZE,AEP tomamos EZE como primario para Google Flights)
        origen_raw = alert.get("origen", "EZE")
        origen = "EZE" if "EZE" in origen_raw else origen_raw
        
        # Mapeo de Destino principal o Países
        paises_interes = alert.get("paises", [])
        destino_principal = alert.get("destino", "Europa")
        
        # Fechas (Tomamos las mínimas exactas como lo solicita la API por ahora)
        dep_date = alert.get("fecha_ida_min") or default_dep
        ret_date = alert.get("fecha_vuelta_min") or default_ret
        
        # Determinar a qué códigos IATA corresponde
        targets = set()
        
        if paises_interes and paises_interes[0] != "Cualquiera":
            for pais in paises_interes:
                targets.update(GEO_MAP.get(pais, [pais])) # Si no está en el mapa, asume que es IATA válido
        else:
            targets.update(GEO_MAP.get(destino_principal, [destino_principal]))
            
        # Añadir al set de búsquedas (De-duplicación)
        for t in targets:
            # Tupla: (origen, destino, fecha_ida, fecha_vuelta)
            unique_searches.add((origen, t, dep_date, ret_date))
            
    # Convertir a lista de diccionarios
    all_searches = [{"origin": s[0], "dest": s[1], "dep_date": s[2], "ret_date": s[3]} for s in unique_searches]
    
    # LÓGICA DE CUOTA: 
    # Supongamos que tenemos límite de 5 búsquedas por ejecución del cron
    MAX_SEARCHES = 5
    
    # Ordenamiento por proximidad de fecha (opcional). Por ahora, seleccionamos aleatoriamente 
    # o de manera determinística basada en el día para asegurar cobertura.
    import random
    # Para ser determinísticos con el día y rotar, podríamos usar el día del año como semilla
    now = datetime.datetime.now()
    seed = now.timetuple().tm_yday + now.hour
    random.seed(seed)
    
    selected_searches = random.sample(all_searches, min(MAX_SEARCHES, len(all_searches)))
    
    print(f"--- ESTRATEGA: De {len(all_searches)} búsquedas únicas, se ejecutarán {len(selected_searches)} para cuidar cuota API ---")
    for s in selected_searches:
        print(f"  -> {s['origin']} a {s['dest']} ({s['dep_date']} / {s['ret_date']})")
        
    return {
        "use_mock": False,
        "searches": selected_searches,
        "alerts_context": alerts # Enviamos las alertas para que el crítico sepa evaluar los presupuestos
    }
