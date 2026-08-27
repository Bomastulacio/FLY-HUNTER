import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.SUPABASE_ANON_KEY || '';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Buscar vuelos en las últimas 24hs
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const { data: deals, error } = await supabase
      .from('flight_deals')
      .select('*')
      .gte('created_at', yesterday.toISOString())
      .order('precio_total_usd', { ascending: true });

    if (error || !deals || deals.length === 0) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'Sin ofertas recientes' 
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Filtrar los que estén aprobados o sean oportunidad de oro
    const approvedDeals = deals.filter(d => d.estado_aprobacion === 'aprobado' || d.es_oportunidad_oro);
    
    if (approvedDeals.length === 0) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'No hay ofertas aprobadas' 
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const bestDeal = approvedDeals[0];

    // Formatear fechas
    const formatDate = (dateStr: string) => {
      if (!dateStr) return '';
      const [y, m, d] = dateStr.split('-');
      const date = new Date(Number(y), Number(m) - 1, Number(d));
      return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(date);
    };

    return new Response(JSON.stringify({
      success: true,
      ruta: `${bestDeal.ida_origen_destino}`,
      precio: `$${Math.round(bestDeal.precio_total_usd)} USD`,
      fechas: `${formatDate(bestDeal.ida_fecha)} al ${formatDate(bestDeal.vuelta_fecha)}`,
      aerolinea: bestDeal.aerolinea
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: 'Error del servidor' }), { status: 500 });
  }
};
