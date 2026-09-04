import pandas as pd
import requests
from typing import List, Dict

def fetch_dolar_tarjeta() -> float:
    """Obtiene la cotización actual del Dólar Tarjeta desde DolarAPI.com"""
    try:
        response = requests.get('https://dolarapi.com/v1/dolares/tarjeta', timeout=10)
        response.raise_for_status()
        data = response.json()
        return float(data.get('venta', 0.0))
    except Exception as e:
        print(f"Error fetching Dolar Tarjeta: {e}")
        return 0.0

def consolidate_and_analyze(flights_data: List[Dict]) -> List[Dict]:
    """
    Analista: consolida los JSON de los recolectores, calcula precio total y unitario 
    por pasajero de manera dinámica, normaliza rutas y calcula conversión a ARS usando Pandas.
    """
    if not flights_data:
        return []
        
    df = pd.DataFrame(flights_data)
    
    # Normalizar strings
    if 'aerolinea' in df.columns:
        df['aerolinea'] = df['aerolinea'].str.title()
    
    # Asegurar pasajeros dinámicos (mínimo 1 pax)
    if 'pasajeros' not in df.columns:
        df['pasajeros'] = 1
    else:
        df['pasajeros'] = df['pasajeros'].fillna(1).astype(int)
        df['pasajeros'] = df['pasajeros'].apply(lambda x: max(1, int(x)))
    
    # Calcular y asegurar precio unitario y total
    if 'precio_total_usd' in df.columns:
        if 'precio_por_pasajero_usd' not in df.columns or df['precio_por_pasajero_usd'].isnull().all():
            df['precio_por_pasajero_usd'] = (df['precio_total_usd'] / df['pasajeros']).round(2)
        else:
            df['precio_por_pasajero_usd'] = df['precio_por_pasajero_usd'].fillna(
                df['precio_total_usd'] / df['pasajeros']
            ).round(2)
        
    # Inteligencia Cambiaria
    dolar_tarjeta = fetch_dolar_tarjeta()
    if dolar_tarjeta > 0 and 'precio_total_usd' in df.columns:
        df['precio_ars_tarjeta'] = (df['precio_total_usd'] * dolar_tarjeta).round(2)
    else:
        df['precio_ars_tarjeta'] = None
    
    # Limpiar duplicados exactos que pudieron venir de múltiples recolectores
    df = df.drop_duplicates(subset=[
        'ida_fecha', 'vuelta_fecha', 'ida_origen_destino', 'aerolinea', 'precio_total_usd'
    ])
    
    return df.to_dict('records')
