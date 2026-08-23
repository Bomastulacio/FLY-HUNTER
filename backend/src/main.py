from dotenv import load_dotenv
import os

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
    for event in graph.stream(initial_state):
        for k, v in event.items():
            print(f"--- Completado nodo: {k} ---")
            
    print("Pipeline finalizado exitosamente.")

if __name__ == "__main__":
    main()
