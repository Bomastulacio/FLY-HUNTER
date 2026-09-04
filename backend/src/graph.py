from typing import TypedDict, List, Dict, Any, Optional
from langgraph.graph import StateGraph, END
import datetime
from .agents.strategist import define_daily_mission, GEO_MAP
from .agents.collectors import collect_dynamic_flights, collect_flights_for_search
from .agents.sanitizer import sanitize_flights
from .agents.analyst import consolidate_and_analyze
from .agents.critic import evaluate_with_llm_critic, filter_and_evaluate
from .agents.data_scientist import data_scientist_analysis
from .services.db import upsert_deals, FlightDeal, mark_as_notified, get_active_search_alerts
from .services.notifications import notify_golden_opportunity, notify_anomaly, notify_glitch_fare

class GraphState(TypedDict, total=False):
    mission: Dict[str, Any]
    alerts_queue: List[Dict[str, Any]]
    current_alert: Optional[Dict[str, Any]]
    current_search: Optional[Dict[str, Any]]
    raw_flights: List[Dict[str, Any]]
    analyzed_flights: List[Dict[str, Any]]
    evaluated_deals: List[Dict[str, Any]]
    all_evaluated_deals: List[Dict[str, Any]]
    iteration_count: int
    max_iterations: int
    needs_refinement: bool
    refinement_reason: str
    suggested_deltas: Dict[str, int]

def strategist_node(state: GraphState) -> GraphState:
    print("\n=======================================================")
    print("🧠 [Estratega Graph Agent]: Definiendo Misión y Plan de Vuelo")
    print("=======================================================")
    mission = define_daily_mission()
    alerts = mission.get("alerts_context", [])
    if not alerts:
        alerts = get_active_search_alerts()
        
    state["mission"] = mission
    state["alerts_queue"] = list(alerts)
    state["all_evaluated_deals"] = []
    state["max_iterations"] = 2  # Límite estricto de loops de refinamiento por alerta para cuidar cuota
    print(f"📋 Alertas activas encoladas en el grafo: {len(state['alerts_queue'])}")
    return state

def pick_alert_node(state: GraphState) -> GraphState:
    queue = state.get("alerts_queue", [])
    if not queue:
        state["current_alert"] = None
        state["current_search"] = None
        return state

    current_alert = queue.pop(0)
    state["alerts_queue"] = queue
    state["current_alert"] = current_alert
    state["iteration_count"] = 0
    state["needs_refinement"] = False
    state["refinement_reason"] = ""
    state["suggested_deltas"] = {"dep_delta": 0, "ret_delta": 0}
    state["raw_flights"] = []
    state["analyzed_flights"] = []
    state["evaluated_deals"] = []

    # Construir búsqueda inicial
    origen_raw = current_alert.get("origen", "EZE")
    origen = "EZE" if "EZE" in origen_raw else origen_raw
    dest = current_alert.get("destino", "MAD")
    
    # Mapeo a IATA si es nombre de país o zona
    if dest in GEO_MAP:
        dest = GEO_MAP[dest][0]
        
    today = datetime.date.today()
    default_dep = (today + datetime.timedelta(days=60)).strftime("%Y-%m-%d")
    default_ret = (today + datetime.timedelta(days=75)).strftime("%Y-%m-%d")
    
    dep_date = current_alert.get("fecha_ida_min") or default_dep
    ret_date = current_alert.get("fecha_vuelta_min") or default_ret
    passengers = max(1, int(current_alert.get("pasajeros", 1) or 1))
    
    state["current_search"] = {
        "origin": origen,
        "dest": dest,
        "dep_date": dep_date,
        "ret_date": ret_date,
        "passengers": passengers
    }
    
    print(f"\n🎯 [Grafo Cíclico: Alerta Seleccionada] {origen} -> {dest} ({dep_date} al {ret_date}) [{passengers} pax]")
    return state

def supervisor_node(state: GraphState) -> GraphState:
    iteration = state.get("iteration_count", 0)
    print(f"📡 [Supervisor Graph Node]: Recolectando vuelos (Iteración {iteration + 1})...")
    mission = state.get("mission", {})
    
    if mission.get("use_mock"):
        state["raw_flights"] = mission.get("mock_data", [])
        return state
        
    current_search = state.get("current_search")
    if current_search:
        # En iteración 0 intenta usar la caché fresca de Supabase ($0 cuota).
        # En iteraciones posteriores (refinamiento) consulta SerpApi fresco.
        check_cache = (iteration == 0)
        flights = collect_flights_for_search(current_search, check_cache_first=check_cache)
    else:
        flights = collect_dynamic_flights(mission)
        
    state["raw_flights"] = flights
    print(f"📦 Recolectados {len(flights)} vuelos para análisis.")
    return state

def sanitizer_node(state: GraphState) -> GraphState:
    raw = state.get("raw_flights", [])
    clean = sanitize_flights(raw)
    state["raw_flights"] = clean
    return state

def analyst_node(state: GraphState) -> GraphState:
    print("📊 [Analista Graph Node]: Consolidando datos y calculando cotizaciones ARS...")
    raw = state.get("raw_flights", [])
    analyzed = consolidate_and_analyze(raw)
    state["analyzed_flights"] = analyzed
    return state

def critic_node(state: GraphState) -> GraphState:
    print("⚖️ [Crítico LLM Node]: Evaluando opciones y decidiendo refinamiento en loop...")
    analyzed = state.get("analyzed_flights", [])
    current_alert = state.get("current_alert", {})
    iteration = state.get("iteration_count", 0)
    max_iter = state.get("max_iterations", 2)
    
    evaluated, needs_refine, advice, deltas = evaluate_with_llm_critic(
        deals=analyzed,
        alert=current_alert,
        iteration=iteration,
        max_iterations=max_iter
    )
    
    state["evaluated_deals"] = evaluated
    state["needs_refinement"] = needs_refine
    state["refinement_reason"] = advice
    state["suggested_deltas"] = deltas
    
    if needs_refine:
        print(f"💡 [Crítico LLM]: Refinamiento activado -> {advice}")
    else:
        print(f"✅ [Crítico LLM]: Vuelos evaluados ({len(evaluated)} procesados). Procediendo a persistencia.")
        
    return state

def refine_search_node(state: GraphState) -> GraphState:
    print("🔄 [Loop de Refinamiento]: Adaptando fechas de búsqueda según consejo del Agente...")
    current_search = state.get("current_search", {})
    deltas = state.get("suggested_deltas", {"dep_delta": 1, "ret_delta": 0})
    dep_delta = deltas.get("dep_delta", 1)
    ret_delta = deltas.get("ret_delta", 0)
    
    try:
        cur_dep = datetime.datetime.strptime(current_search["dep_date"], "%Y-%m-%d").date()
        cur_ret = datetime.datetime.strptime(current_search["ret_date"], "%Y-%m-%d").date()
        
        new_dep = cur_dep + datetime.timedelta(days=dep_delta)
        new_ret = cur_ret + datetime.timedelta(days=ret_delta)
        
        # Validar lógica de viaje
        if new_ret <= new_dep:
            new_ret = new_dep + datetime.timedelta(days=14)
            
        current_search["dep_date"] = new_dep.strftime("%Y-%m-%d")
        current_search["ret_date"] = new_ret.strftime("%Y-%m-%d")
        print(f"📅 Nuevas fechas refinadas: {current_search['dep_date']} ✈️ {current_search['ret_date']}")
    except Exception as e:
        print(f"Error refinando fechas: {e}")
        
    state["iteration_count"] = state.get("iteration_count", 0) + 1
    state["raw_flights"] = []
    state["needs_refinement"] = False
    return state

def persistence_and_notify_node(state: GraphState) -> GraphState:
    print("💾 [Persistencia y Notificaciones]: Guardando deals y alertando usuario...")
    deals = state.get("evaluated_deals", [])
    if not deals:
        print("No hay vuelos para guardar en este lote.")
        return state
        
    # Crear objetos Pydantic
    db_deals = []
    for d in deals:
        try:
            deal_obj = FlightDeal(**d)
            db_deals.append(deal_obj)
        except Exception as e:
            print(f"Error parsing deal to Pydantic: {e}")
            
    # Upsert a Supabase
    upsert_deals(db_deals)
    
    # Notificaciones automáticas
    for d in deals:
        if d.get("es_tarifa_error") and not d.get("notificado"):
            notify_glitch_fare(d)
            mark_as_notified(d['hash_dedupe'])
        elif d.get("es_oportunidad_oro") and not d.get("notificado"):
            notify_golden_opportunity(d)
            mark_as_notified(d['hash_dedupe'])
        elif d.get("es_anomalia") and d.get("estado_aprobacion") == "pendiente" and not d.get("notificado"):
            notify_anomaly(d)
            mark_as_notified(d['hash_dedupe'])
            
    all_deals = state.get("all_evaluated_deals", [])
    all_deals.extend(deals)
    state["all_evaluated_deals"] = all_deals
    return state

def data_scientist_node(state: GraphState) -> GraphState:
    all_deals = state.get("all_evaluated_deals", [])
    print(f"\n📈 [Data Scientist Node]: Ejecutando ML y tendencias para {len(all_deals)} vuelos totales...")
    data_scientist_analysis(all_deals)
    return state

# =======================================================
# Enrutamiento Condicional (Edges con Loops en LangGraph)
# =======================================================
def route_after_critic(state: GraphState) -> str:
    """Loop 1: Refinamiento y auto-corrección adaptativa de búsqueda"""
    if state.get("needs_refinement") and state.get("iteration_count", 0) < state.get("max_iterations", 2):
        print(f"🔁 [LangGraph Edge]: Refinamiento requerido. Volviendo al recolector...")
        return "refine_search"
    return "persist_notify"

def route_after_persist(state: GraphState) -> str:
    """Loop 2: Procesamiento iterativo de todas las alertas activas"""
    queue = state.get("alerts_queue", [])
    if queue and len(queue) > 0:
        print(f"🔁 [LangGraph Edge]: Quedan {len(queue)} alertas en la cola. Continuando loop...")
        return "pick_alert"
    print("🏁 [LangGraph Edge]: Todas las alertas procesadas. Avanzando a Data Scientist.")
    return "data_scientist"

def build_graph() -> StateGraph:
    """
    Arquitectura de Grafos (LangGraph State Machine)
    Integra:
    1. Agente LLM Crítico con razonamiento y generación de refinamientos.
    2. Loop Cíclico de Refinamiento de Búsqueda (Self-Correction).
    3. Loop Cíclico Multi-Alerta para todas las alertas activas en Supabase.
    4. Protección y control estricto de cuota (250 búsquedas/mes).
    """
    builder = StateGraph(GraphState)
    
    # Agregar Nodos
    builder.add_node("strategist", strategist_node)
    builder.add_node("pick_alert", pick_alert_node)
    builder.add_node("supervisor", supervisor_node)
    builder.add_node("sanitizer", sanitizer_node)
    builder.add_node("analyst", analyst_node)
    builder.add_node("critic", critic_node)
    builder.add_node("refine_search", refine_search_node)
    builder.add_node("persist_notify", persistence_and_notify_node)
    builder.add_node("data_scientist", data_scientist_node)
    
    # Definir Edges y Ciclos
    builder.set_entry_point("strategist")
    builder.add_edge("strategist", "pick_alert")
    builder.add_edge("pick_alert", "supervisor")
    builder.add_edge("supervisor", "sanitizer")
    builder.add_edge("sanitizer", "analyst")
    builder.add_edge("analyst", "critic")
    
    # Edge Condicional 1: Loop de Refinamiento
    builder.add_conditional_edges(
        "critic", 
        route_after_critic, 
        {
            "refine_search": "refine_search",
            "persist_notify": "persist_notify"
        }
    )
    builder.add_edge("refine_search", "supervisor")  # Cierre del ciclo 1
    
    # Edge Condicional 2: Loop Multi-Alerta
    builder.add_conditional_edges(
        "persist_notify",
        route_after_persist,
        {
            "pick_alert": "pick_alert",
            "data_scientist": "data_scientist"
        }
    )
    
    builder.add_edge("data_scientist", END)
    
    return builder.compile()
