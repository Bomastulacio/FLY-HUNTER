import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';

export const prerender = false;

// Control en memoria de tasa de peticiones (Rate limiting)
const requestCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 30; // Máximo 30 peticiones
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // por minuto

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = requestCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return true;
  }
  entry.count++;
  return false;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    // 1. Rate Limiting por IP segura de proxy (Vercel)
    const clientIp = request.headers.get('x-real-ip') ||
                     request.headers.get('x-vercel-ip') ||
                     'local';
    if (isRateLimited(clientIp)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Demasiadas solicitudes. Intentá nuevamente en un minuto.' }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } }
      );
    }

    // 2. Validación de Autenticación
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Acceso no autorizado. Sesión requerida.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const token = authHeader.replace('Bearer ', '').trim();

    const env = (import.meta as any).env || process.env || {};
    const supabaseUrl = env.PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '';
    const supabaseAnonKey = env.PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || '';

    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Configuración de Supabase no disponible en el servidor.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Cliente con token del usuario (valida criptográficamente el JWT contra Supabase Auth)
    const supabaseAuthClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: authError } = await supabaseAuthClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Sesión inválida o expirada.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // A valid session identifies a user; it does not authorize changing global
    // observations. app_metadata is server-managed, unlike user_metadata.
    // Keep ADMIN_TOKEN for trusted backend callers; never ship it to the UI.
    const configuredAdminToken = String(env.ADMIN_TOKEN || '');
    const suppliedAdminToken = request.headers.get('X-Admin-Token') || '';
    const adminTokenMatches = configuredAdminToken.length > 0
      && Buffer.byteLength(configuredAdminToken) === Buffer.byteLength(suppliedAdminToken)
      && timingSafeEqual(Buffer.from(configuredAdminToken), Buffer.from(suppliedAdminToken));
    if (user.app_metadata?.flight_hunter_admin !== true && !adminTokenMatches) {
      return new Response(JSON.stringify({ success: false, error: 'Esta acción requiere una cuenta administradora.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    // 3. Validación de cuerpo y parámetros
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return new Response(
        JSON.stringify({ success: false, error: 'Cuerpo de solicitud inválido.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { deal_id, action } = body;
    const isValidUuid = typeof deal_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deal_id);

    if (!isValidUuid || !['aprobar', 'rechazar'].includes(action)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Parámetros inválidos. deal_id (UUID) y action ("aprobar" | "rechazar") requeridos.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 4. Actualización segura del vuelo
    const newStatus = action === 'aprobar' ? 'aprobado' : 'rechazado';
    const updatePayload: Record<string, any> = {
      estado_aprobacion: newStatus,
    };
    if (action === 'aprobar') {
      updatePayload.notificado = false;
    }

    // Global observations are writable only by the authorized backend.
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      return new Response(JSON.stringify({ success: false, error: 'Configuración administrativa no disponible.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
    const dbClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    const { data, error } = await dbClient
      .from('flight_deals')
      .update(updatePayload)
      .eq('id', deal_id)
      .eq('estado_aprobacion', 'pendiente')
      .select('id, ida_origen_destino, vuelta_origen_destino, estado_aprobacion')
      .maybeSingle();

    if (error) {
      console.error('[API anomaly-action] Error al actualizar oferta:', error);
      return new Response(
        JSON.stringify({ success: false, error: 'Error al actualizar el estado de la oferta.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!data) {
      return new Response(JSON.stringify({ success: false, error: 'La oferta ya fue revisada o no está pendiente.' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } });
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
      JSON.stringify({ success: false, error: 'Error interno del servidor' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
