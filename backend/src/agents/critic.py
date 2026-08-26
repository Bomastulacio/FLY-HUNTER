import hashlib
from typing import List, Dict

BUDGET_MIN = 1700
BUDGET_MAX = 2400
CRITICAL_THRESHOLD = 1700
GLITCH_THRESHOLD = 900

VALID_DEPARTURE_DATES = ["2027-04-17", "2027-04-18", "2027-04-19"]
VALID_RETURN_DATES = ["2027-04-26", "2027-04-27", "2027-04-28", "2027-04-29", "2027-04-30", "2027-05-01", "2027-05-02"]

def generate_hash(deal: Dict) -> str:
    # hash_dedupe text unique -- md5(ida_fecha || ida_od || vuelta_fecha || vuelta_od || aerolinea || round(precio))
    raw_str = (
        f"{deal.get('ida_fecha', '')}"
        f"{deal.get('ida_origen_destino', '')}"
        f"{deal.get('vuelta_fecha', '')}"
        f"{deal.get('vuelta_origen_destino', '')}"
        f"{deal.get('aerolinea', '')}"
        f"{round(deal.get('precio_total_usd', 0))}"
    )
    return hashlib.md5(raw_str.encode('utf-8')).hexdigest()

def evaluate_deal(deal: Dict) -> Dict:
    """
    Agente Crítico: evalúa la oferta contra las reglas de negocio.
    """
    precio = deal.get("precio_total_usd", 0)
    ida_fecha = deal.get("ida_fecha", "")
    vuelta_fecha = deal.get("vuelta_fecha", "")
    escalas = deal.get("cantidad_escalas", 0)
    
    # Generar Hash
    deal['hash_dedupe'] = generate_hash(deal)
    deal['es_oportunidad_oro'] = False
    deal['es_anomalia'] = False
    deal['es_tarifa_error'] = False
    deal['estado_aprobacion'] = 'no_aplica'
    deal['notificado'] = False
    
    # Regla 0: Filtro estricto de escalas (rechazo inmediato)
    if escalas > 1:
        deal['estado_aprobacion'] = 'rechazado'
        return deal
        
    # Regla 0.5: Tarifa Error (Glitch Fare)
    if precio < GLITCH_THRESHOLD:
        deal['es_tarifa_error'] = True
        deal['estado_aprobacion'] = 'aprobado'
        return deal
        
    # Regla 1: Oportunidad de Oro
    if precio < CRITICAL_THRESHOLD:
        deal['es_oportunidad_oro'] = True
        deal['estado_aprobacion'] = 'aprobado' # Se aprueba directamente
        return deal
        
    # Validaciones normales
    fecha_ok = (ida_fecha in VALID_DEPARTURE_DATES) and (vuelta_fecha in VALID_RETURN_DATES)
    presupuesto_ok = (BUDGET_MIN <= precio <= BUDGET_MAX)
    escalas_ok = (escalas <= 1) # Máximo de escalas razonables (sin escala o 1)
    
    # Regla 2: Anomalía (rompe parámetros levemente pero es barata)
    if not fecha_ok and precio < (BUDGET_MAX - 200):
        # Ej: Fecha fuera de rango, pero buen precio
        deal['es_anomalia'] = True
        deal['estado_aprobacion'] = 'pendiente'
        return deal
        

    # Regla 3: Aprobación estándar
    if fecha_ok and presupuesto_ok and escalas_ok:
        deal['estado_aprobacion'] = 'aprobado'
        return deal
        
    # Si llega acá, se rechaza
    deal['estado_aprobacion'] = 'rechazado'
    return deal

def filter_and_evaluate(deals: List[Dict]) -> List[Dict]:
    evaluated_deals = []
    # Agrupamos por destino para buscar el más barato de cada uno
    deals_by_dest = {}
    
    for deal in deals:
        dest = deal.get("vuelta_origen_destino", "").split("-")[0] # ej MAD de MAD-EZE
        if not dest: 
            continue
            
        evaluated = evaluate_deal(deal)
        
        if dest not in deals_by_dest:
            deals_by_dest[dest] = []
        deals_by_dest[dest].append(evaluated)
        
    for dest, d_list in deals_by_dest.items():
        # Filtramos los que sí pasaron la prueba
        valid_deals = [d for d in d_list if d['estado_aprobacion'] != 'rechazado']
        
        if valid_deals:
            evaluated_deals.extend(valid_deals)
        else:
            # Lógica "Mejor del Día": Si todos fueron rechazados, rescatamos el más barato
            cheapest = min(d_list, key=lambda x: x.get("precio_total_usd", 999999))
            cheapest['estado_aprobacion'] = 'aprobado'
            # Aseguramos que no dispare emails
            cheapest['es_oportunidad_oro'] = False
            cheapest['es_anomalia'] = False
            cheapest['es_tarifa_error'] = False
            evaluated_deals.append(cheapest)
            
    return evaluated_deals
