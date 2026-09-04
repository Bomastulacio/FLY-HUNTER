import hashlib
from typing import List, Dict

GLITCH_THRESHOLD_PER_PAX = 400.0  # Tarifa error si es menor a USD 400 por pasajero (ida y vuelta)
DEFAULT_MAX_BUDGET_PER_PAX = 1200.0

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
    return hashlib.md5(raw_str.encode('utf-8'), usedforsecurity=False).hexdigest()  # nosec B324

def evaluate_deal(deal: Dict, alerts: List[Dict]) -> Dict:
    """
    Agente Crítico: evalúa la oferta de manera dinámica contra las alertas reales
    del usuario (presupuesto por pasajero, fechas y límites de escalas).
    """
    pasajeros_deal = max(1, int(deal.get("pasajeros", 1) or 1))
    precio_total = float(deal.get("precio_total_usd", 0) or 0)
    
    # Calcular precio unitario por pasajero
    if deal.get("precio_por_pasajero_usd"):
        precio_por_pasajero = float(deal["precio_por_pasajero_usd"])
    else:
        precio_por_pasajero = round(precio_total / pasajeros_deal, 2)
        
    ida_fecha = deal.get("ida_fecha", "")
    vuelta_fecha = deal.get("vuelta_fecha", "")
    escalas = deal.get("cantidad_escalas", 0)
    
    # Generar Hash y campos por defecto
    deal['hash_dedupe'] = generate_hash(deal)
    deal['es_oportunidad_oro'] = False
    deal['es_anomalia'] = False
    deal['es_tarifa_error'] = False
    deal['estado_aprobacion'] = 'no_aplica'
    deal['notificado'] = False
    
    # Regla 0: Tarifa Error (Glitch Fare detectada)
    if 0 < precio_por_pasajero < GLITCH_THRESHOLD_PER_PAX:
        deal['es_tarifa_error'] = True
        deal['estado_aprobacion'] = 'aprobado'
        return deal

    # Evaluar contra las alertas activas del usuario
    is_golden = False
    is_approved = False
    
    if not alerts:
        # Fallback a umbrales generales por pasajero si no hay alertas configuradas
        if escalas <= 1:
            if precio_por_pasajero <= (DEFAULT_MAX_BUDGET_PER_PAX * 0.70):
                is_golden = True
            elif precio_por_pasajero <= DEFAULT_MAX_BUDGET_PER_PAX:
                is_approved = True
    else:
        for alert in alerts:
            # 1. Validar escalas permitidas para esta alerta
            escalas_max = alert.get("escalas_max", 1)
            if escalas > escalas_max:
                continue
                
            # 2. Validar rango de fechas de la alerta
            dep_min = alert.get("fecha_ida_min")
            dep_max = alert.get("fecha_ida_max") or dep_min
            ret_min = alert.get("fecha_vuelta_min")
            ret_max = alert.get("fecha_vuelta_max") or ret_min
            
            fecha_ok = True
            if dep_min and dep_max:
                fecha_ok = fecha_ok and (dep_min <= ida_fecha <= dep_max)
            if ret_min and ret_max:
                fecha_ok = fecha_ok and (ret_min <= vuelta_fecha <= ret_max)
                
            if not fecha_ok:
                continue
                
            # 3. Validar presupuesto según la cantidad de pasajeros de la alerta
            pasajeros_alerta = max(1, int(alert.get("pasajeros", 1) or 1))
            presupuesto_max = float(alert.get("presupuesto_max", 2400) or 2400)
            
            # Costo total que pagaría el usuario para su grupo
            costo_para_alerta = precio_por_pasajero * pasajeros_alerta
            
            # Oportunidad de Oro: 30% más barata que el presupuesto
            if costo_para_alerta <= (presupuesto_max * 0.70):
                is_golden = True
                is_approved = True
                break
                
            # Aprobado normal si está dentro de presupuesto
            if costo_para_alerta <= presupuesto_max:
                is_approved = True
                break
                
    if is_golden:
        deal['es_oportunidad_oro'] = True
        deal['estado_aprobacion'] = 'aprobado'
        return deal
        
    if is_approved:
        deal['estado_aprobacion'] = 'aprobado'
        return deal
        
    # Si no cumplió presupuesto ni fechas de ninguna alerta, queda rechazado
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
