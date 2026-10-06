import pandas as pd
import numpy as np
import holidays
from typing import List, Dict
from datetime import datetime
from ..services.db import get_recent_flight_deals, upsert_route_insights, RouteInsight, get_supabase_client
from ..services.geography import airport_country


def holiday_for_airport(code, date_str):
    country = airport_country(code)
    if not country or not date_str:
        return False
    try:
        day = datetime.strptime(date_str, '%Y-%m-%d').date()
        return day in holidays.country_holidays(country, years=[day.year])
    except (ValueError, TypeError, NotImplementedError):
        return False  # Unknown calendar is never replaced with another country's.

def data_scientist_analysis(current_deals: List[Dict]) -> None:
    print("--- Data Scientist: Iniciando análisis de tendencias y feriados ---")
    
    # 1. Analizar e inferir feriados para los vuelos actuales y actualizar la DB
    client = get_supabase_client()
    for d in current_deals:
        hash_id = d.get('hash_dedupe')
        if not hash_id:
            continue
            
        ida_f = d.get('ida_fecha')
        vuelta_f = d.get('vuelta_fecha')
        ruta = d.get('ida_origen_destino', '')
        origin_code, _, dest_code = ruta.partition('-')
        
        fer_origen = holiday_for_airport(origin_code, ida_f)
        fer_dest = holiday_for_airport(dest_code, vuelta_f)
        
        if hash_id:
            try:
                client.table('flight_deals').update({
                    'es_feriado_origen': fer_origen,
                    'es_feriado_destino': fer_dest
                }).eq('hash_dedupe', hash_id).execute()
            except Exception as e:
                print(f"Error updating holiday flags for {hash_id}: {e}")

    # 2. Descargar historial de los últimos 30 días para calcular ML/Tendencias
    try:
        deals_data = get_recent_flight_deals(days=30)
        if not deals_data:
            print("No hay datos históricos suficientes para análisis ML.")
            return
            
        df = pd.DataFrame(deals_data)
        if 'created_at' not in df.columns or 'precio_total_usd' not in df.columns:
            return
            
        # Convertir fechas para análisis temporal soportando variantes ISO (con o sin microsegundos)
        df['created_at'] = pd.to_datetime(df['created_at'], format='ISO8601', utc=True, errors='coerce')
        df['precio_total_usd'] = pd.to_numeric(df['precio_total_usd'], errors='coerce')
        df = df.dropna(subset=['created_at', 'precio_total_usd'])
        if df.empty:
            print("No hay datos históricos válidos con created_at y precio_total_usd.")
            return

        df = df.sort_values('created_at')
        
        insights = []
        
        for route, group in df.groupby('ida_origen_destino'):
            if group.empty:
                continue
            # Mínimo absoluto de este mes
            min_price = float(group['precio_total_usd'].min())
            
            # Promedio Móvil 7 Días
            last_7d = group[group['created_at'] >= (group['created_at'].max() - pd.Timedelta(days=7))]
            avg_7d = float(last_7d['precio_total_usd'].mean()) if not last_7d.empty else min_price
            
            # Regresión Lineal (Polyfit) para la Tendencia
            trend = 0.0
            if len(group) > 1:
                x = (group['created_at'] - group['created_at'].min()).dt.total_seconds()
                y = group['precio_total_usd']
                if x.nunique() > 1:
                    slope, _ = np.polyfit(x, y, 1)
                    # Escalar la pendiente para que signifique "cambio de USD por día"
                    trend = float(slope * 86400)
                    
            insight = RouteInsight(
                ruta=str(route),
                precio_promedio_7d=float(avg_7d),
                minimo_historico=float(min_price),
                tendencia=float(trend)
            )
            insights.append(insight)
            
        # Guardar los insights procesados en la base de datos
        upsert_route_insights(insights)
        print("--- Data Scientist: Análisis completado y guardado ---")
    except Exception as e:
        print(f"Error en Data Scientist análisis de tendencias: {e}")

