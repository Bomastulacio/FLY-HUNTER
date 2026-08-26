import os
import datetime
from typing import Dict, Any

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
    },
    {
        "ida_fecha": "2027-04-17",
        "vuelta_fecha": "2027-04-26",
        "ida_origen_destino": "EZE-CDG",
        "vuelta_origen_destino": "CDG-EZE",
        "precio_original": 2500.0,
        "moneda_original": "USD",
        "precio_total_usd": 2500.0,
        "aerolinea": "Air France",
        "cantidad_escalas": 0,
        "duracion_total_minutos": 700,
        "link_reserva": "https://google.com/flights",
        "fuente": "mock"
    }
]

def define_daily_mission() -> Dict[str, Any]:
    """
    Estratega: Decide qué buscar hoy para no exceder la cuota mensual de 250 peticiones.
    También soporta un modo TEST_MODE para correr el pipeline sin golpear a SerpApi.
    """
    # 1. Chequear Modo Test / Manual Override
    if os.environ.get("TEST_MODE", "").lower() == "true":
        print("--- ESTRATEGA: MODO TEST ACTIVADO. Usando datos Mock (0 consumo de API) ---")
        return {
            "use_mock": True,
            "mock_data": MOCK_FLIGHTS
        }
        
    now = datetime.datetime.now()
    day_of_year = now.timetuple().tm_yday
    hour = now.hour
    
    # Destinos actuales de collectors.py
    europe = ["MAD", "CDG", "LHR", "BER"]
    asia = ["NRT", "KIX"]
    
    # Fechas
    dep_dates = ["2027-04-17", "2027-04-18", "2027-04-19"]
    ret_dates = ["2027-04-26", "2027-04-27", "2027-04-28", "2027-04-29", "2027-04-30", "2027-05-01", "2027-05-02"]
    dep = dep_dates[day_of_year % len(dep_dates)]
    ret = ret_dates[day_of_year % len(ret_dates)]
    
    mission = {
        "use_mock": False,
        "dep_date": dep,
        "ret_date": ret,
        "run_europe": False,
        "europe_dests": [],
        "run_asia": False,
        "asia_dests": [],
        "run_lufthansa": False,
        "lufthansa_dests": []
    }
    
    # 2. Lógica de partición de API (máximo 2 peticiones por corrida)
    print(f"--- ESTRATEGA: Calculando misión para hora {hour}:00 ---")
    if 0 <= hour < 6:
        mission["run_europe"] = True
        idx = (day_of_year * 2) % len(europe)
        mission["europe_dests"] = [europe[idx], europe[(idx+1)%len(europe)]]
        print(f"Misión Asignada: Europa {mission['europe_dests']}")
        
    elif 6 <= hour < 12:
        mission["run_lufthansa"] = True
        idx = (day_of_year * 2) % len(europe)
        mission["lufthansa_dests"] = [europe[idx], europe[(idx+1)%len(europe)]]
        print(f"Misión Asignada: Lufthansa {mission['lufthansa_dests']}")
        
    elif 12 <= hour < 18:
        mission["run_asia"] = True
        mission["asia_dests"] = asia
        print(f"Misión Asignada: Asia {mission['asia_dests']}")
        
    else:
        # 18:00 a 23:59
        mission["run_europe"] = True
        idx = (day_of_year * 2 + 2) % len(europe)
        mission["europe_dests"] = [europe[idx], europe[(idx+1)%len(europe)]]
        print(f"Misión Asignada: Europa {mission['europe_dests']}")
        
    return mission
