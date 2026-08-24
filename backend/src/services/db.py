import os
from supabase import create_client, Client
from pydantic import BaseModel
from typing import List, Optional

url: str = os.environ.get("SUPABASE_URL", "")
key: str = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

# Client init
def get_supabase_client() -> Client:
    if not url or not key:
        print("Warning: Supabase credentials not found. DB operations will fail.")
    return create_client(url, key)

class FlightDeal(BaseModel):
    ida_fecha: str
    ida_origen_destino: str
    vuelta_fecha: str
    vuelta_origen_destino: str
    precio_total_usd: float
    precio_original: Optional[float] = None
    moneda_original: Optional[str] = None
    aerolinea: str
    cantidad_escalas: int
    duracion_total_minutos: int
    es_oportunidad_oro: bool = False
    es_anomalia: bool = False
    estado_aprobacion: str = 'no_aplica'
    notificado: bool = False
    fuente: str = 'fli'
    link_reserva: str = ""
    hash_dedupe: str

def upsert_deals(deals: List[FlightDeal]) -> None:
    if not deals:
        return
    client = get_supabase_client()
    data = [deal.model_dump() for deal in deals]
    try:
        # We rely on Supabase unique constraint to avoid duplicates 
        # (on conflict do nothing is the default behavior if we just use insert and catch exception or if we do an upsert ignoring updates)
        # Using upsert to be safe, assuming hash_dedupe is unique.
        client.table('flight_deals').upsert(data, on_conflict='hash_dedupe').execute()
        print(f"Successfully upserted {len(deals)} deals to Supabase.")
    except Exception as e:
        print(f"Error upserting deals to Supabase: {e}")

def mark_as_notified(hash_dedupe: str) -> None:
    client = get_supabase_client()
    try:
        client.table('flight_deals').update({'notificado': True}).eq('hash_dedupe', hash_dedupe).execute()
    except Exception as e:
        print(f"Error updating notified status: {e}")

class RouteInsight(BaseModel):
    ruta: str
    precio_promedio_7d: float
    minimo_historico: float
    tendencia: float

def upsert_route_insights(insights: List[RouteInsight]) -> None:
    if not insights:
        return
    client = get_supabase_client()
    data = [insight.model_dump() for insight in insights]
    try:
        client.table('route_insights').upsert(data, on_conflict='ruta').execute()
        print(f"Successfully upserted {len(insights)} route insights to Supabase.")
    except Exception as e:
        print(f"Error upserting route insights to Supabase: {e}")

def get_recent_flight_deals(days: int = 30) -> List[dict]:
    client = get_supabase_client()
    try:
        from datetime import datetime, timedelta
        import pytz
        
        past_date = datetime.now(pytz.UTC) - timedelta(days=days)
        past_date_str = past_date.isoformat()
        
        response = client.table('flight_deals').select('*').gte('created_at', past_date_str).execute()
        return response.data
    except Exception as e:
        print(f"Error fetching recent deals: {e}")
        return []
