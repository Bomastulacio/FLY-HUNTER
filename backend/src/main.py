from dotenv import load_dotenv
import os
import json
import time

# Cargar variables de entorno locales si existen
load_dotenv()

from .graph import build_graph

def main():
    print("Iniciando Flight Hunter Pipeline...")
    
    # Crear y compilar el grafo
    graph = build_graph()
    
    # Estado inicial vacío
    initial_state = {
        "raw_flights": [],
        "analyzed_flights": [],
        "evaluated_deals": []
    }
    
    # Ejecutar el grafo
    started = time.monotonic()
    for event in graph.stream(initial_state, {"recursion_limit": 120}):
        for k, v in event.items():
            state = v or {}
            print(json.dumps({"event": "graph.node_completed", "node": k,
                "run_id": os.environ.get('GITHUB_RUN_ID', 'local'),
                "radar_id": (state.get('current_alert') or {}).get('id'),
                "iteration": state.get('iteration_count', 0),
                "raw": len(state.get('raw_flights') or []),
                "analyzed": len(state.get('analyzed_flights') or []),
                "evaluated": len(state.get('evaluated_deals') or []),
                "remaining": len(state.get('alerts_queue') or []),
                "elapsed_ms": round((time.monotonic() - started) * 1000)}))
            
    print("Pipeline finalizado exitosamente.")

if __name__ == "__main__":
    main()
