/** Local visual fixture, never served by Astro/Vercel. Node >= 24.
 * node evals/preview_frontend.mjs
 * Uses the real home markup, styles and client code, with synthetic auth/data.
 * No Supabase writes, tokens or account access. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const root = new URL('../frontend/', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const alert = { id: 'demo-europe', nombre: 'Europa en abril', origen: 'EZE, AEP', destino: 'Europa',
  pasajeros: 2, escalas_max: 1, presupuesto_min: 1700, presupuesto_max: 2400,
  fecha_ida_min: '2027-04-17', fecha_ida_max: '2027-04-19', fecha_vuelta_min: '2027-04-26',
  fecha_vuelta_max: '2027-05-02', aerolineas_excluidas: ['LEVEL'], paises: ['España', 'Francia', 'Italia', 'Alemania'] };
const alerts = [alert, { ...alert, id: 'demo-direct', nombre: 'Solo vuelos directos', escalas_max: 0 }];
const deals = [['demo-mad', 'MAD', 2047, 1, 'Aeroméxico'], ['demo-cdg', 'CDG', 2183, 0, 'Air France'], ['demo-fco', 'FCO', 2316, 1, 'ITA Airways']].map(([id, dest, price, stops, airline]) => ({
  id, ida_origen_destino: `EZE-${dest}`, vuelta_origen_destino: `${dest}-EZE`,
  ida_fecha: '2027-04-17', vuelta_fecha: '2027-05-02', pasajeros: 2, precio_total_usd: price,
  cantidad_escalas: stops, aerolinea: airline, estado_aprobacion: 'aprobado',
  fuente: 'google_flights', created_at: new Date().toISOString(),
}));

createServer(async (req, res) => {
  try {
    if (req.url === '/styles.css') {
      res.setHeader('Content-Type', 'text/css');
      res.end((await read('src/styles/global.css')) + '\n' + await read('src/styles/compact.css'));
      return;
    }
    if (req.url === '/favicon.svg') {
      res.setHeader('Content-Type', 'image/svg+xml'); res.end(await read('public/favicon.svg')); return;
    }
    if (req.url?.startsWith('/alertas')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<p>Destino de edición verificado en esta vista de prueba. El wizard real está en Astro.</p>'); return;
    }
    const source = await read('src/pages/index.astro');
    const client = source.match(/<script>\s*([\s\S]*?)<\/script>/)[1]
      .replace(/import \{ supabase \} from '..\/lib\/supabase';/, '')
      .replace(/import \{ renderCompactFlight, escapeHtml, usd \} from '..\/utils\/compactFlights';/, '');
    const card = stripTypeScriptTypes(await read('src/utils/compactFlights.ts')).replace(/export /g, '');
    const data = { allDeals: deals, approvedDeals: deals, pendingDeals: [], routeInsights: [] };
    const mock = `const supabase = { auth: {
      getSession: async () => ({data:{session:{user:{id:'ui-fixture-user', email:'preview@example.test', user_metadata:{}}}}}),
      signOut: async () => {}, onAuthStateChange: () => {}
    }, from: () => ({select(){return this},eq(){return this},order:async()=>({data:${JSON.stringify(alerts)}})})};`;
    const code = `${card}\n${mock}\n${stripTypeScriptTypes(client)}`;
    let html = source.slice(source.indexOf('<html'))
      .replace(/<script is:inline define:vars=[\s\S]*?<\/script>/, () => `<script>window.__SERVER_DATA__=${JSON.stringify(data)}</script>`)
      .replace(/<script>\s*import[\s\S]*?<\/script>/, () => `<script type="module">${code}</script>`)
      .replace('</head>', '<link rel="stylesheet" href="/styles.css"></head>')
      .replace('<body class="compact-app">', '<body class="compact-app"><div style="padding:4px;text-align:center;font-size:11px;color:#a9b0a3">Vista de prueba · datos de ejemplo</div>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
  } catch (error) {
    res.writeHead(500); res.end(String(error));
  }
}).listen(4322, '127.0.0.1', () => console.log('UI fixture: http://127.0.0.1:4322'));
