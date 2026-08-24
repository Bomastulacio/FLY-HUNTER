import pandas as pd
import numpy as np
import holidays
from typing import List, Dict
from datetime import datetime
from ..services.db import get_recent_flight_deals, upsert_route_insights, RouteInsight, get_supabase_client

def data_scientist_analysis(current_deals: List[Dict]) -> None:
    print("--- Data Scientist: Iniciando análisis de tendencias y feriados ---")
    
    # 1. Analizar e inferir feriados para los vuelos actuales y actualizar la DB
    ar_holidays = holidays.AR()
    country_map = {
        'MAD': holidays.ES(), 'BCN': holidays.ES(),
        'CDG': holidays.FR(), 'ORY': holidays.FR(),
        'LHR': holidays.GB(), 'LGW': holidays.GB(),
        'BER': holidays.DE(), 'FRA': holidays.DE(), 'MUC': holidays.DE(),
        'NRT': holidays.JP(), 'HND': holidays.JP(), 'KIX': holidays.JP()
    }
    
    def is_holiday(date_str, hol_obj):
        try:
            d = datetime.strptime(date_str, '%Y-%m-%d').date()
            return d in hol_obj
        except:
            return False
            
    client = get_supabase_client()
    for d in current_deals:
        hash_id = d.get('hash_dedupe')
        if not hash_id:
            continue
            
        ida_f = d.get('ida_fecha')
        vuelta_f = d.get('vuelta_fecha')
        ruta = d.get('ida_origen_destino', '')
        dest_code = ruta.split('-')[-1] if '-' in ruta else 'MAD'
        
        fer_origen = is_holiday(ida_f, ar_holidays) if ida_f else False
        dest_hol = country_map.get(dest_code, holidays.ES())
        fer_dest = is_holiday(vuelta_f, dest_hol) if vuelta_f else False
        
        if fer_origen or fer_dest:
            try:
                client.table('flight_deals').update({
                    'es_feriado_origen': fer_origen,
                    'es_feriado_destino': fer_dest
                }).eq('hash_dedupe', hash_id).execute()
            except Exception as e:
                print(f"Error updating holiday flags for {hash_id}: {e}")

    # 2. Descargar historial de los últimos 30 días para calcular ML/Tendencias
    deals_data = get_recent_flight_deals(days=30)
    if not deals_data:
        print("No hay datos históricos suficientes para análisis ML.")
        return
        
    df = pd.DataFrame(deals_data)
    if 'created_at' not in df.columns or 'precio_total_usd' not in df.columns:
        return
        
    # Convertir fechas para análisis temporal
    df['created_at'] = pd.to_datetime(df['created_at'])
    df = df.sort_values('created_at')
    
    insights = []
    
    for route, group in df.groupby('ida_origen_destino'):
        # Mínimo absoluto de este mes
        min_price = group['precio_total_usd'].min()
        
        # Promedio Móvil 7 Días
        last_7d = group[group['created_at'] >= (group['created_at'].max() - pd.Timedelta(days=7))]
        avg_7d = last_7d['precio_total_usd'].mean() if not last_7d.empty else min_price
        
        # Regresión Lineal (Polyfit) para la Tendencia
        trend = 0.0
        if len(group) > 1:
            x = (group['created_at'] - group['created_at'].min()).dt.total_seconds()
            y = group['precio_total_usd']
            if x.nunique() > 1:
                slope, _ = np.polyfit(x, y, 1)
                # Escalar la pendiente para que signifique "cambio de USD por día"
                trend = slope * 86400 
                
        insight = RouteInsight(
            ruta=route,
            precio_promedio_7d=float(avg_7d),
            minimo_historico=float(min_price),
            tendencia=float(trend)
        )
        insights.append(insight)
        
    # Guardar los insights procesados en la base de datos
    upsert_route_insights(insights)
    print("--- Data Scientist: Análisis completado y guardado ---")
