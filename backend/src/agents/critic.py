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

def evaluate_deal(deal: Dict, alerts: List[Dict]) -> Dict:
    """
    Agente Crítico: evalúa la oferta de manera dinámica contra los presupuestos del usuario.
    """
    precio_total = deal.get("precio_total_usd", 0) # El recolector trae el precio x2 por defecto
    precio_por_pasajero = precio_total / 2.0
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
    if precio_por_pasajero < (GLITCH_THRESHOLD / 2.0):
        deal['es_tarifa_error'] = True
        deal['estado_aprobacion'] = 'aprobado'
        return deal

    # Evaluar contra TODAS las alertas (MVP: si cumple para al menos una, se aprueba/notifica)
    is_golden = False
    is_approved = False
    
    if not alerts:
        # Fallback a constantes si no hay alertas activas
        if precio_total < (BUDGET_MAX - 200) or precio_total < CRITICAL_THRESHOLD:
            is_golden = True
        if precio_total <= BUDGET_MAX:
            is_approved = True
    else:
        for alert in alerts:
            pasajeros = alert.get("pasajeros", 1)
            presupuesto_max = alert.get("presupuesto_max", 2400)
            
            # Calcular cuánto le saldría al usuario según su grupo
            precio_usuario = precio_por_pasajero * pasajeros
            
            # Regla 1: Oportunidad de Oro (30% más barato que el presupuesto máximo)
            if precio_usuario <= (presupuesto_max * 0.70):
                is_golden = True
                is_approved = True
                
            # Validaciones normales
            fecha_ok = (ida_fecha in VALID_DEPARTURE_DATES) and (vuelta_fecha in VALID_RETURN_DATES)
            if fecha_ok and (precio_usuario <= presupuesto_max):
                is_approved = True
                
    if is_golden:
        deal['es_oportunidad_oro'] = True
        deal['estado_aprobacion'] = 'aprobado'
        return deal
        
    if is_approved:
        deal['estado_aprobacion'] = 'aprobado'
        return deal
        
    # Si llega acá, se rechaza
    deal['estado_aprobacion'] = 'rechazado'
    return deal

def filter_and_evaluate(deals: List[Dict], alerts: List[Dict] = None) -> List[Dict]:
    if alerts is None:
        alerts = []
        
    # Construir un set de aerolíneas excluidas global (MVP - asumiendo single user o exclusión general)
    excluded_airlines = set()
    for alert in alerts:
        excl = alert.get("aerolineas_excluidas")
        if excl:
            for a in excl:
                excluded_airlines.add(a.strip().lower())

    evaluated_deals = []
    # Agrupamos por destino para buscar el más barato de cada uno
    deals_by_dest = {}
    
    for deal in deals:
        dest = deal.get("vuelta_origen_destino", "").split("-")[0] # ej MAD de MAD-EZE
        if not dest: 
            continue
            
        airline = deal.get("aerolinea", "").strip().lower()
        
        # Si la aerolínea está excluida, ni siquiera entra a la lista de consideraciones para ese destino
        if airline and airline in excluded_airlines:
            continue
            
        evaluated = evaluate_deal(deal, alerts)
        
        if dest not in deals_by_dest:
            deals_by_dest[dest] = []
        deals_by_dest[dest].append(evaluated)
        
    for dest, d_list in deals_by_dest.items():
        if not d_list:
            continue
            
        # Filtramos los que sí pasaron la prueba
        valid_deals = [d for d in d_list if d['estado_aprobacion'] != 'rechazado']
        
        if valid_deals:
            evaluated_deals.extend(valid_deals)
        else:
            # Lógica "Mejor del Día": Si todos fueron rechazados (ej. por presupuesto), rescatamos el más barato
            cheapest = min(d_list, key=lambda x: x.get("precio_total_usd", 999999))
            cheapest['estado_aprobacion'] = 'aprobado'
            # Aseguramos que no dispare emails
            cheapest['es_oportunidad_oro'] = False
            cheapest['es_anomalia'] = False
            cheapest['es_tarifa_error'] = False
            evaluated_deals.append(cheapest)
            
    return evaluated_deals
