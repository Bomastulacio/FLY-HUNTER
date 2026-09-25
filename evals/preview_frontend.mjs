/** Local visual fixture, never served by Astro/Vercel. Node >= 24.
 * node evals/preview_frontend.mjs
 * Uses the real home markup, styles and client code, with synthetic auth/data.
 * No Supabase writes, tokens or account access. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const root = new URL('../frontend/', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const previewPort = Number(process.env.FH_PREVIEW_PORT || 4322);
const alert = { id: 'demo-north-america', nombre: 'Escapada a Estados Unidos', origen: 'EZE, AEP', destino: 'Estados Unidos',
  pasajeros: 2, escalas_max: 1, presupuesto_min: 1700, presupuesto_max: 2400,
  fecha_ida_min: '2027-04-17', fecha_ida_max: '2027-04-19', fecha_vuelta_min: '2027-04-26',
  fecha_vuelta_max: '2027-05-02', aerolineas_excluidas: ['LEVEL'], paises: ['Estados Unidos'] };
const alerts = [alert, { ...alert, id: 'demo-direct', nombre: 'Solo vuelos directos', escalas_max: 0 }];
const deals = [['demo-mia', 'MIA', 1380, 0, 'LATAM'], ['demo-lax', 'LAX', 1416, 1, 'LATAM'], ['demo-sfo', 'SFO', 1678, 1, 'United']].map(([id, dest, price, stops, airline]) => ({
  id, ida_origen_destino: `EZE-${dest}`, vuelta_origen_destino: `${dest}-EZE`,
  ida_fecha: '2027-04-17', vuelta_fecha: '2027-05-02', pasajeros: 2, precio_total_usd: price,
  cantidad_escalas: stops, aerolinea: airline, estado_aprobacion: 'aprobado',
  fuente: 'google_flights', created_at: new Date().toISOString(),
  detalle_cotizacion: { googleParserVersion: 2, priceVerified: true, queryVerified: true, searchView: 'cheapest' },
}));

createServer(async (req, res) => {
  try {
    if (req.url === '/auth.css') { res.setHeader('Content-Type', 'text/css'); res.end(await read('src/styles/auth.css')); return; }
    if (req.url === '/utils/authFlow.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(stripTypeScriptTypes(await read('src/utils/authFlow.ts')).replace("import { supabase } from '../lib/supabase';", "const supabase={auth:{signUp:async()=>({data:{user:{id:'fixture'},session:null},error:null}),resend:async()=>({error:null}),signInWithPassword:async()=>({error:{message:'Invalid login credentials'}}),signInWithOAuth:async()=>({error:{message:'Offline fixture'}})}};")); return;
    }
    if (req.url === '/login' || req.url === '/registro') {
      const page = await read(`src/pages${req.url}.astro`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(page.slice(page.indexOf('<html')).replace("from '../utils/authFlow'", "from '/utils/authFlow.js'").replace('<script>', '<script type="module">').replace('</head>', '<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/auth.css"></head>')); return;
    }
    if (req.url?.startsWith('/styles.css')) {
      res.setHeader('Content-Type', 'text/css');
      const widget = await read('src/components/SearchWidget.astro');
      const settings = await read('src/pages/alertas.astro');
      const extra = req.url.includes('settings') ? widget.match(/<style>([\s\S]*?)<\/style>/)[1] + '\n' + settings.match(/<style>([\s\S]*?)<\/style>/)[1] : '';
      res.end((await read('src/styles/global.css')) + '\n' + extra + '\n' + await read('src/styles/compact.css'));
      return;
    }
    if (req.url && /^\/utils\/(compactFlights|radarPicker|searchSchedule|monitoringView|latestQuotes)\.js$/.test(req.url)) {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(stripTypeScriptTypes(await read(`src${req.url.replace(/\.js$/, '.ts')}`))
        .replace("from './compactFlights'", "from './compactFlights.js'")
        .replace("import { supabase } from '../lib/supabase';", "const supabase={from:()=>({select(){return this},eq(){return this},update(){return this},maybeSingle:async()=>({data:null,error:null}),upsert:async()=>({error:null})})};"));
      return;
    }
    if (req.url === '/favicon.svg') {
      res.setHeader('Content-Type', 'image/svg+xml'); res.end(await read('public/favicon.svg')); return;
    }
    if (req.url?.startsWith('/destinations/') && /^\/destinations\/[a-z_-]+\.jpg$/.test(req.url)) {
      res.setHeader('Content-Type', 'image/jpeg'); res.end(await readFile(new URL(`public${req.url}`, root))); return;
    }
    const settingsPage = req.url?.startsWith('/alertas');
    const source = await read(settingsPage ? 'src/pages/alertas.astro' : 'src/pages/index.astro');
    const prepare = code => stripTypeScriptTypes(code
      .replace(/import \{ supabase \} from '..\/lib\/supabase';/, '')
      .replace(/from '..\/utils\/(\w+)'/g, "from '/utils/$1.js'"));
    const client = prepare(source.match(/<script>\s*([\s\S]*?)<\/script>/)[1]);
    const data = { allDeals: deals, approvedDeals: deals, pendingDeals: [], routeInsights: [] };
    const previewQuery = new URL(req.url, 'http://localhost').searchParams;
    const delay = Math.min(15000, Math.max(0, Number(previewQuery.get('delay')) || 0));
    const mock = `const supabase = { auth: {
      getUser: async () => ({data:{user:{id:'ui-fixture-user',email:'preview@example.test',user_metadata:{}}}}),
      getSession: async () => { await new Promise(resolve => setTimeout(resolve, ${delay})); ${previewQuery.has('fail') ? 'throw new Error("Offline fixture");' : ''} return ({data:{session:{user:{id:'ui-fixture-user', email:'preview@example.test', user_metadata:{}}}}}); },
      signOut: async () => {}, onAuthStateChange: () => {}
    }, from: () => ({select(){return this},update(){return this},insert:async()=>({error:null}),eq(){return this},order:async()=>({data:${JSON.stringify(previewQuery.has('new') ? [] : alerts)}})})};`;
    const code = `${mock}\n${client}`;
    let html = source.slice(source.indexOf('<html'))
      .replace(/<script is:inline define:vars=[\s\S]*?<\/script>/, () => `<script>window.__SERVER_DATA__=${JSON.stringify(data)}</script>`)
      .replace(/<script>\s*import[\s\S]*?<\/script>/, () => `<script type="module">${code}</script>`)
      .replace('</head>', `<link rel="stylesheet" href="/styles.css${settingsPage ? '?settings' : ''}"></head>`)
      .replace('<body class="compact-app">', '<body class="compact-app"><div style="padding:4px;text-align:center;font-size:11px;color:#a9b0a3">Vista de prueba · datos de ejemplo</div>');
    if (settingsPage) {
      const widget = await read('src/components/SearchWidget.astro');
      const markup = widget.slice(widget.indexOf('<div class="search-widget-wrapper">'), widget.indexOf('<style>'));
      const widgetCode = prepare(widget.match(/<script>\s*([\s\S]*?)<\/script>/)[1]);
      html = html.replace('<SearchWidget />', () => `${markup}<script type="module">${mock}\n${widgetCode}</script>`);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
  } catch (error) {
    res.writeHead(500); res.end(String(error));
  }
}).listen(previewPort, '127.0.0.1', () => console.log(`UI fixture: http://127.0.0.1:${previewPort}`));
