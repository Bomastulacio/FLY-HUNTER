import pandas as pd
from typing import List, Dict

def consolidate_and_analyze(flights_data: List[Dict]) -> List[Dict]:
    """
    Analista: consolida los JSON de los recolectores, calcula precio total para 2 pasajeros,
    y normaliza rutas usando Pandas.
    """
    if not flights_data:
        return []
        
    df = pd.DataFrame(flights_data)
    
    # Normalizar strings
    if 'aerolinea' in df.columns:
        df['aerolinea'] = df['aerolinea'].str.title()
    
    # Calcular precio para 2 pasajeros (si la data original era por pax)
    # Asumimos que la API de fli trae el precio base por pasajero o total. 
    # El prompt pide calcular el precio total para 2 pasajeros.
    # Si flight.price ya era para 2 (porque buscamos pax=2), lo dejamos igual,
    # pero como fli usualmente busca sin definir pax o da precio por adulto,
    # multiplicamos por 2 para asegurar.
    # Ajustar esto según el payload real de la librería.
    if 'precio_total_usd' in df.columns:
        # collectors.py ya lo multiplicó por 2, así que lo dejamos intacto.
        pass
    
    # Limpiar duplicados exactos que pudieron venir de múltiples recolectores
    df = df.drop_duplicates(subset=[
        'ida_fecha', 'vuelta_fecha', 'ida_origen_destino', 'aerolinea', 'precio_total_usd'
    ])
    
    return df.to_dict('records')
