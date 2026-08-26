from typing import TypedDict, List, Dict, Any
from langgraph.graph import StateGraph, END
from .agents.collectors import collect_europe, collect_asia, collect_lufthansa
from .agents.analyst import consolidate_and_analyze
from .agents.critic import filter_and_evaluate
from .agents.data_scientist import data_scientist_analysis
from .services.db import upsert_deals, FlightDeal, mark_as_notified

class GraphState(TypedDict):
    raw_flights: List[Dict]
    analyzed_flights: List[Dict]
    evaluated_deals: List[Dict]

def supervisor_node(state: GraphState) -> GraphState:
    print("--- Supervisor: Iniciando recolección paralela ---")
    # LangGraph no tiene paralelismo out-of-the-box súper simple sin map/reduce,
    # pero podemos llamar a los recolectores secuencialmente dentro de un nodo
    # o usar hilos de Python. Como es sincrónico y rápido, lo hacemos secuencial aquí por simplicidad,
    # pero en un grafo real con LLMs usaríamos Send().
    
    # Recolección
    europe = collect_europe()
    asia = collect_asia()
    lufthansa = collect_lufthansa()
    
    state["raw_flights"] = europe + asia + lufthansa
    return state

def analyst_node(state: GraphState) -> GraphState:
    print("--- Analista: Consolidando datos ---")
    raw = state.get("raw_flights", [])
    analyzed = consolidate_and_analyze(raw)
    state["analyzed_flights"] = analyzed
    return state

def critic_node(state: GraphState) -> GraphState:
    print("--- Crítico: Evaluando contra reglas de negocio ---")
    analyzed = state.get("analyzed_flights", [])
    evaluated = filter_and_evaluate(analyzed)
    state["evaluated_deals"] = evaluated
    return state

def persistence_and_notify_node(state: GraphState) -> GraphState:
    print("--- Persistencia y Notificaciones ---")
    deals = state.get("evaluated_deals", [])
    if not deals:
        print("No hay vuelos aprobados o pendientes para guardar.")
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
    
    # Notificaciones
    for d in deals:
        if d.get("es_oportunidad_oro") and not d.get("notificado"):
            notify_golden_opportunity(d)
            mark_as_notified(d['hash_dedupe'])
        elif d.get("es_anomalia") and d.get("estado_aprobacion") == "pendiente" and not d.get("notificado"):
            notify_anomaly(d)
            mark_as_notified(d['hash_dedupe'])
            
    return state

def data_scientist_node(state: GraphState) -> GraphState:
    deals = state.get("evaluated_deals", [])
    data_scientist_analysis(deals)
    return state

def build_graph() -> StateGraph:
    builder = StateGraph(GraphState)
    
    # Agregar Nodos
    builder.add_node("supervisor", supervisor_node)
    builder.add_node("analyst", analyst_node)
    builder.add_node("critic", critic_node)
    builder.add_node("persist_notify", persistence_and_notify_node)
    builder.add_node("data_scientist", data_scientist_node)
    
    # Definir Edges (Flujo)
    builder.set_entry_point("supervisor")
    builder.add_edge("supervisor", "analyst")
    builder.add_edge("analyst", "critic")
    builder.add_edge("critic", "persist_notify")
    builder.add_edge("persist_notify", "data_scientist")
    builder.add_edge("data_scientist", END)
    
    return builder.compile()
