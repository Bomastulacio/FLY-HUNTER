import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

// Usamos el SERVICE_ROLE_KEY para poder actualizar la tabla sin importar el RLS (porque la acción viene del admin local o está protegida)
const supabaseUrl = import.meta.env.SUPABASE_URL || '';
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ghToken = import.meta.env.GH_DISPATCH_TOKEN || '';
const ghRepo = import.meta.env.GH_REPO || 'tu-usuario/fly-hunter';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { id, action, token } = await request.json();

    const adminToken = import.meta.env.ADMIN_TOKEN;
    if (adminToken && token !== adminToken) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
    }

    if (!id || !['aprobado', 'rechazado'].includes(action)) {
      return new Response(JSON.stringify({ error: 'Parámetros inválidos' }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Actualizamos el estado en Supabase
    const { error: dbError } = await supabase
      .from('flight_deals')
      .update({ estado_aprobacion: action })
      .eq('id', id);

    if (dbError) {
      console.error(dbError);
      return new Response(JSON.stringify({ error: 'Error actualizando DB' }), { status: 500 });
    }

    // Si se aprobó, queremos disparar el repository_dispatch de Github Actions
    if (action === 'aprobado' && ghToken) {
      const ghResponse = await fetch(`https://api.github.com/repos/${ghRepo}/dispatches`, {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `token ${ghToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          event_type: 'resume-after-approval'
        })
      });

      if (!ghResponse.ok) {
        console.error("Github Action dispatch falló:", await ghResponse.text());
        // No devolvemos error al cliente porque la DB sí se actualizó, 
        // pero en un caso real se podría manejar distinto.
      }
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: 'Error del servidor' }), { status: 500 });
  }
};
