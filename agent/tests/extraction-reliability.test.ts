import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { collectDespegar } from '../src/skills/despegar.js';
import { collectGoogleFlights } from '../src/skills/googleFlights.js';
import { parseCard } from '../src/skills/quoteParser.js';
import { parseGoogleResult } from '../src/skills/googleQuote.js';

const params = { origin: 'EZE', destination: 'MAD', departureDate: '2027-04-18', returnDate: '2027-05-01', passengers: 2, maxStops: 1 };
const snapshot = {
  text: 'Final 2 personas US$ 1.884 Con Débito IDA dom. 18 abr. 2027 EZE MAD 1 escala VUELTA sáb. 1 may. 2027 MAD EZE 1 escala',
  airlineNames: ['Aeroméxico'], pagePassengerCount: 2,
  bookingUrl: 'https://www.despegar.com.ar/shop/flights/results/', collectedAt: '2026-09-14T12:00:00Z',
};

// Reduced fixtures are local regression examples, never production observations.
test('Despegar requires evidence for each direction and rejects conflicting party sizes', () => {
  assert.deepEqual(parseCard('despegar', snapshot, params)?.evidence?.stopsPerDirection, [1, 1]);
  for (const text of [
    snapshot.text.replace('18 abr. 2027', '1 may. 2027').replace('VUELTA sáb. 1 may. 2027', 'VUELTA dom. 18 abr. 2027'),
    snapshot.text.replace('VUELTA sáb. 1 may. 2027 MAD EZE', 'VUELTA sáb. 1 may. 2027 EZE MAD'),
    snapshot.text.replace('1 escala VUELTA', '1 escala 1 escala VUELTA').replace(/1 escala$/, ''),
    snapshot.text.replace('Final 2 personas', 'Final 1 persona Para 2 adultos'),
    snapshot.text.replace(/1 escala$/, '2 escalas'),
  ]) assert.equal(parseCard('despegar', { ...snapshot, text }, params), undefined, text);
});

test('Google never assigns the requested day to a row with a different explicit departure date', () => {
  const prefix = 'A partir de 1884 dólares estadounidenses (precio total de ida y vuelta). Vuelo con 1 escala de Aeromexico. Sale de Ezeiza';
  const parseDate = (date: string) => parseGoogleResult({
    label: `${prefix}${date ? ` el ${date} a las 23:25` : ''}. Seleccionar vuelo`,
    visiblePrices: ['1.884 US$'], passengers: 2, bookingUrl: 'https://www.google.com/travel/flights', collectedAt: snapshot.collectedAt,
  }, params);
  for (const date of ['domingo, abril 18', 'domingo, 18 de abril de 2027', 'abril 18, 2027', '2027-04-18', '']) {
    assert.equal(parseDate(date)?.departureDate, params.departureDate, date);
  }
  for (const date of ['sábado, abril 17', 'mayo 18', 'abril 18 de 2028', '2027-04-19']) {
    assert.equal(parseDate(date), undefined, date);
  }
});

async function withOfflineBrowser<T>(fixture: string, run: () => Promise<T>): Promise<{ result: T; requests: number }> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  let requests = 0;
  await context.route('**/*', route => {
    requests++;
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture });
  });
  const newContext = mock.method(browser, 'newContext', async () => context);
  const launch = mock.method(chromium, 'launch', async () => browser);
  try { return { result: await run(), requests }; }
  finally { launch.mock.restore(); newContext.mock.restore(); await browser.close(); }
}

test('Despegar retains visible screenshot fares when hidden variants and CSS crossed prices coexist', async () => {
  const card = (airline: string, price: string, stops: string, extra = '') => `<article class="cluster-container" ${extra}>
    <div>Final <b>2 personas</b></div><span class="fare-before">US$ 2.475</span>
    <div><span>US$</span><strong>${price}</strong></div><div>Con Débito</div>
    <div>IDA dom. 18 abr. 2027 EZE MAD <span class="airline-name">${airline}</span> ${stops}</div>
    <div>VUELTA sáb. 1 may. 2027 MAD EZE <span class="airline-name">${airline}</span> ${stops}</div>
    <div class="hidden-variant">Final 1 persona US$ 850 <span class="airline-name">LEVEL</span> 2 escalas</div>
    </article>`;
  const fixture = `<style>.fare-before { text-decoration: line-through; } .hidden-variant { display: none; }</style>
    ${card('Aeroméxico', '1.884', '1 escala')}
    ${card('Aerolíneas Argentinas', '2.376', 'Directo')}
    ${card('Hidden carrier', '777', 'Directo', 'hidden')}`;
  const { result, requests } = await withOfflineBrowser(fixture, () => collectDespegar({ ...params, excludedAirlines: ['LEVEL'] }));
  assert.equal(result.status, 'ok', JSON.stringify(result));
  assert.deepEqual(result.options.map(q => [q.airline, q.priceTotalUSD, q.evidence?.stopsPerDirection]), [
    ['Aeroméxico', 1884, [1, 1]], ['Aerolíneas Argentinas', 2376, [0, 0]],
  ]);
  assert.ok(result.options.every(q => q.passengers === 2 && q.paymentCondition === 'Precio con débito'));
  assert.equal(requests, 2);
});

test('Google does not publish a provisional fare when the results remain loading', async () => {
  const label = 'A partir de 1884 dólares estadounidenses (precio total de ida y vuelta). Vuelo con 1 escala de Aeromexico. Sale de Ezeiza. Seleccionar vuelo';
  const fixture = `<input role="combobox" aria-label="¿Desde dónde? Buenos Aires EZE">
    <input role="combobox" aria-label="¿A dónde quieres ir? Madrid MAD">
    <input aria-label="Salida" value="dom, 18 abr"><input aria-label="Vuelta" value="sáb, 1 may">
    <button role="switch" aria-label="Hacer un seguimiento con salida el 2027-04-18 y vuelta el 2027-05-01"></button>
    <button id="cheap" role="tab" aria-selected="false">Los más bajos</button>
    <div id="panel" role="tabpanel" aria-label="Los más bajos">
      El precio incluye los impuestos y las comisiones correspondientes a 2 adultos.
      <li class="pIav2d"><div role="link" aria-label="${label}"></div>
        <span role="text" aria-label="1884 dólares estadounidenses">1.884 US$</span></li>
    </div>
    <script>document.getElementById('cheap').onclick = () => {
      document.getElementById('cheap').setAttribute('aria-selected', 'true');
      document.getElementById('panel').insertAdjacentHTML('afterbegin', '<div role="progressbar">Cargando</div>');
    };</script>`;
  const { result, requests } = await withOfflineBrowser(fixture, () => collectGoogleFlights(params));
  assert.equal(result.status, 'error');
  assert.equal(result.reason, 'page_timeout');
  assert.deepEqual(result.options, []);
  assert.equal(requests, 1);
});

test('Google reports a late CAPTCHA as blocked so the source cooldown survives the run', async () => {
  const fixture = `<button role="tab">Los más bajos</button><div role="progressbar">Cargando</div>
    <script>setTimeout(() => document.body.insertAdjacentHTML('beforeend', '<div>CAPTCHA: verify you are human</div>'), 50);</script>`;
  const { result, requests } = await withOfflineBrowser(fixture, () => collectGoogleFlights(params));
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.options, []);
  assert.equal(requests, 1);
});
