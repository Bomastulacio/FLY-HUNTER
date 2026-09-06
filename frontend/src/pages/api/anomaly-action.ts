import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { deal_id, action } = body;

    if (!deal_id || !['aprobar', 'rechazar'].includes(action)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Parámetros inválidos. deal_id y action ("aprobar" | "rechazar") requeridos.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || import.meta.env.SUPABASE_URL || '';
    const supabaseKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY || import.meta.env.PUBLIC_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY || '';

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Configuración de Supabase no disponible en el servidor.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Inicializar cliente Supabase
    const authHeader = request.headers.get('Authorization');
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: authHeader ? { Authorization: authHeader } : {},
      }
    });

    const newStatus = action === 'aprobar' ? 'aprobado' : 'rechazado';
    const updatePayload: Record<string, any> = {
      estado_aprobacion: newStatus,
    };

    if (action === 'aprobar') {
      // Si el usuario aprueba la anomalía, se marca notificado en false
      updatePayload.notificado = false;
    }

    const { data, error } = await supabase
      .from('flight_deals')
      .update(updatePayload)
      .eq('id', deal_id)
      .select('id, ida_origen_destino, vuelta_origen_destino, estado_aprobacion')
      .single();

    if (error) {
      console.error('[API anomaly-action] Error al actualizar oferta:', error);
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        deal: data,
        action,
        message: action === 'aprobar' 
          ? 'Anomalía aprobada con éxito. Ahora aparecerá en tu radar activo.' 
          : 'Anomalía descartada.'
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[API anomaly-action] Excepción:', err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Error interno del servidor' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
