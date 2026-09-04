import os
import json
import hashlib
import requests
from typing import List, Dict, Any, Tuple

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

def evaluate_with_llm_critic(
    deals: List[Dict], 
    alert: Dict,
    iteration: int = 0,
    max_iterations: int = 2
) -> Tuple[List[Dict], bool, str, Dict[str, int]]:
    """
    Agente Crítico LLM (Graph Node):
    Utiliza Gemini (o OpenAI) para razonamiento semántico sobre las tarifas aéreas.
    Determina si los vuelos son aprobados y si se requiere un loop de refinamiento
    (ej: ajustar fechas +1 o -1 día) para encontrar mejores ofertas dentro del presupuesto.
    
    Retorna: (evaluated_deals, needs_refinement, refinement_reason, suggested_deltas)
    """
    # 1. Evaluación base heurística para garantizar consistencia en hashes y flags
    evaluated = filter_and_evaluate(deals, [alert] if alert else [])
    
    has_approved_deal = any(
        d.get('estado_aprobacion') == 'aprobado' and (d.get('es_oportunidad_oro') or not d.get('es_mejor_del_dia', False))
        for d in evaluated
    )
    
    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
    openai_key = os.environ.get("OPENAI_API_KEY", "").strip()
    
    # Si no hay LLM key o ya se llegó al máximo de iteraciones, usar heurística
    if not (gemini_key or openai_key) or iteration >= max_iterations:
        needs_refine = (not has_approved_deal) and (len(deals) > 0) and (iteration < max_iterations)
        advice = "No se encontraron ofertas dentro de presupuesto. Refinando fechas (+1 día ida)." if needs_refine else ""
        deltas = {"dep_delta": 1, "ret_delta": 0} if needs_refine else {"dep_delta": 0, "ret_delta": 0}
        return evaluated, needs_refine, advice, deltas

    # Si hay Gemini o OpenAI, realizar razonamiento de agente
    pasajeros = max(1, int(alert.get("pasajeros", 1) or 1))
    presupuesto = float(alert.get("presupuesto_max", 2400) or 2400)
    escalas_max = int(alert.get("escalas_max", 1) or 1)
    
    prompt = f"""
    Eres el Agente Crítico de Inteligencia de 'Fly Hunter' en un Grafo Cíclico de Búsqueda de Vuelos.
    
    OBJETIVO:
    Evaluar los vuelos obtenidos para la alerta del usuario y decidir si se aprueban o si conviene
    realizar un LOOP DE REFINAMIENTO cambiando las fechas dentro de la ventana de viaje.
    
    CRITERIOS DEL USUARIO:
    - Pasajeros: {pasajeros}
    - Presupuesto Máximo Total: US$ {presupuesto}
    - Escalas Máximas: {escalas_max}
    - Iteración Actual del Grafo: {iteration + 1} de {max_iterations}
    
    VUELOS RECOLECTADOS ({len(deals)} opciones):
    {json.dumps([{{'aerolinea': d.get('aerolinea'), 'precio_usd': d.get('precio_total_usd'), 'escalas': d.get('cantidad_escalas'), 'ida': d.get('ida_fecha'), 'vuelta': d.get('vuelta_fecha')}} for d in deals[:6]], indent=2)}
    
    DECISIÓN:
    1. Si hay algún vuelo con precio <= US$ {presupuesto} y escalas <= {escalas_max}, aprueba y NO refines (needs_refinement = false).
    2. Si los vuelos superan el presupuesto o no hay vuelos y aún quedan iteraciones ({iteration + 1} < {max_iterations}):
       activa needs_refinement = true y propone una pequeña modificación de fechas (dep_delta: +1 o -1 día, ret_delta: 0 o +1).
    3. Si ya no hay margen de iteración, needs_refinement = false.
    
    Responde ÚNICAMENTE con un JSON válido con este formato:
    {{
      "needs_refinement": bool,
      "refinement_reason": "explicación clara en 1 frase",
      "dep_delta": int,
      "ret_delta": int,
      "summary_notification": "frase atractiva para el usuario"
    }}
    """
    
    try:
        if gemini_key:
            # Consulta directa a Gemini API v1beta
            models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]
            for model in models:
                try:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={gemini_key}"
                    payload = {
                        "contents": [{"parts": [{"text": prompt}]}],
                        "generationConfig": {"responseMimeType": "application/json"}
                    }
                    res = requests.post(url, json=payload, timeout=15)
                    if res.status_code == 200:
                        content = res.json()["candidates"][0]["content"]["parts"][0]["text"]
                        data = json.loads(content)
                        print(f"🤖 [Agente Crítico LLM ({model})]: {data.get('refinement_reason') or data.get('summary_notification')}")
                        needs_refine = bool(data.get("needs_refinement", False)) and (iteration < max_iterations)
                        deltas = {
                            "dep_delta": int(data.get("dep_delta", 1)),
                            "ret_delta": int(data.get("ret_delta", 0))
                        }
                        return evaluated, needs_refine, data.get("refinement_reason", ""), deltas
                except Exception as model_err:
                    continue
                    
    except Exception as e:
        print(f"⚠️ [Agente Crítico LLM]: Excepción al consultar LLM ({e}). Usando fallback heurístico.")
        
    needs_refine = (not has_approved_deal) and (len(deals) > 0) and (iteration < max_iterations)
    advice = "Presupuesto superado. Probando fechas alternativas." if needs_refine else ""
    deltas = {"dep_delta": 1, "ret_delta": 0} if needs_refine else {"dep_delta": 0, "ret_delta": 0}
    return evaluated, needs_refine, advice, deltas
