import hashlib
from typing import List, Dict

BUDGET_MIN = 1700
BUDGET_MAX = 4000
CRITICAL_THRESHOLD = 2000

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
    deal['estado_aprobacion'] = 'no_aplica'
    deal['notificado'] = False
    
    # Regla 1: Oportunidad de Oro
    if precio < CRITICAL_THRESHOLD:
        deal['es_oportunidad_oro'] = True
        deal['estado_aprobacion'] = 'aprobado' # Se aprueba directamente
        return deal
        
    # Validaciones normales
    fecha_ok = (ida_fecha in VALID_DEPARTURE_DATES) and (vuelta_fecha in VALID_RETURN_DATES)
    presupuesto_ok = (precio <= BUDGET_MAX)
    escalas_ok = (escalas <= 2) # Máximo arbitrario de escalas razonables
    
    # Regla 2: Anomalía (rompe parámetros levemente pero es barata)
    if not fecha_ok and precio < (BUDGET_MAX - 200):
        # Ej: Fecha fuera de rango, pero buen precio
        deal['es_anomalia'] = True
        deal['estado_aprobacion'] = 'pendiente'
        return deal
        
    if not escalas_ok and precio < (BUDGET_MAX - 300):
        # Ej: Muchas escalas, pero muy buen precio
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
    for deal in deals:
        evaluated = evaluate_deal(deal)
        # Solo conservamos los que no fueron rechazados, o los guardamos igual pero como 'rechazado'?
        # Normalmente guardamos solo los aprobados o pendientes.
        if evaluated['estado_aprobacion'] != 'rechazado':
            evaluated_deals.append(evaluated)
    return evaluated_deals
