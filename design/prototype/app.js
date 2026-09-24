const $ = (selector) => document.querySelector(selector);
const money = (value) => `US$${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(value)}`;
const day = (value) => new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00`));
const countries = {
  es: { name: 'España', city: 'Madrid', airport: 'MAD', price: 2047, airline: 'Iberia', stops: 0, photo: 'madrid.jpg' },
  it: { name: 'Italia', city: 'Roma', airport: 'FCO', price: 2316, airline: 'ITA Airways', stops: 1, photo: 'rome.jpg' },
  fr: { name: 'Francia', city: 'París', airport: 'CDG', price: 2483, airline: 'Air France', stops: 0, photo: 'paris.jpg' },
  pt: { name: 'Portugal', city: 'Lisboa', airport: 'LIS', price: 2198, airline: 'TAP', stops: 1, photo: 'lisbon.jpg' },
};
let prefs = { countries: ['es', 'it', 'fr', 'pt'], pinned: 'it', budget: 2400, target: 1800, nightsMin: 10, nightsMax: 15, outMin: '2027-04-17', outMax: '2027-04-19', backMin: '2027-04-26', backMax: '2027-05-02' };
let view = 'radar';
let scenario = 'normal';
const saved = new Map();
const openCards = new Set();
let toastTimer;
function toast(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3400);
}
function quotes() {
  if (scenario === 'empty') return [];
  // Demo observations are fixed: editing dates never invents new provider results.
  const departure = '2027-04-18', returning = '2027-04-30', nights = 12;
  if (departure < prefs.outMin || departure > prefs.outMax || returning < prefs.backMin || returning > prefs.backMax || nights < prefs.nightsMin || nights > prefs.nightsMax) return [];
  return prefs.countries.map(id => ({ id, ...countries[id], departure, returning,
    price: countries[id].price + (scenario === 'over' ? prefs.budget : 0) - (scenario === 'italy' && id === 'it' ? 420 : 0),
  })).sort((a, b) => a.price - b.price);
}
function ticket(q, winner, pinned, bestPrice) {
  const above = q.price > prefs.budget;
  const flag = view === 'saved' ? 'Guardado por vos' : winner ? (pinned ? 'Menor precio · tu país fijo' : 'Menor precio encontrado') : 'Siempre visible';
  const comparison = above ? `${money(q.price - prefs.budget)} sobre tu máximo` : winner ? `${money(prefs.budget - q.price)} bajo tu máximo` : bestPrice < q.price ? `${money(q.price - bestPrice)} más que la ganadora` : 'Dentro de tu presupuesto';
  return `<article class="ticket ${winner ? 'ticket--winner' : 'ticket--pinned'}" data-card="${q.id}" aria-label="${q.name}, ${q.city}">
    <div class="ticket-photo"><img src="assets/${q.photo}" alt="" width="700" height="400"><span class="ticket-flag"><i class="ph ${winner ? 'ph-sparkle' : 'ph-push-pin'}" aria-hidden="true"></i>${flag}</span><div class="ticket-place"><p>${q.name.toUpperCase()} / ${q.airport}</p><h3>${q.city}</h3></div></div>
    <button class="round save" data-save="${q.id}" aria-label="${saved.has(q.id) ? 'Quitar' : 'Guardar'} ${q.city}" aria-pressed="${saved.has(q.id)}"><i class="ph ph-bookmark-simple" aria-hidden="true"></i></button>
    <div class="ticket-body"><div class="price-line"><strong class="price"><span>US$</span>${money(q.price).replace('US$', '')}</strong><span class="price-note">${above ? 'Fuera de presupuesto' : 'Ida y vuelta'}</span></div><p class="total-note">Total para 2 adultos · ${money(q.price / 2)} por persona</p>
    <div class="ticket-route"><span>EZE</span><span class="route-track"><i class="ph ph-airplane-tilt" aria-hidden="true"></i></span><span>${q.airport}</span></div>
    <div class="facts"><div><small>FECHAS · 12 NOCHES</small><span>${day(q.departure)} — ${day(q.returning)}</span></div><div><small>${q.stops ? '1 ESCALA' : 'DIRECTO'}</small><span>${q.airline}</span></div></div>
    <details data-detail="${q.id}" ${openCards.has(q.id) ? 'open' : ''}><summary><span>Explorar este vuelo</span><i class="ph ph-caret-down" aria-hidden="true"></i></summary><div class="expanded"><dl><div><dt>IDA</dt><dd>EZE → ${q.airport}<br>${day(q.departure)} 2027</dd></div><div><dt>VUELTA</dt><dd>${q.airport} → EZE<br>${day(q.returning)} 2027</dd></div></dl><p>${comparison}. ${view === 'saved' ? 'Conservamos la cotización de ejemplo que guardaste.' : 'Esta combinación de ejemplo cumple las fechas, las noches y las escalas elegidas.'}</p><p class="evidence">Cotización ilustrativa. Horarios, equipaje y condiciones de pago no verificados. No es una oferta disponible para comprar.</p><button class="demo-cta" data-demo-book="${q.id}">Ver en Google Flights <i class="ph ph-arrow-up-right" aria-hidden="true"></i></button></div></details>
    <p class="ticket-foot"><i class="ph ph-clock" aria-hidden="true"></i>${scenario === 'blocked' ? 'Último precio de ejemplo · hace 2 días' : 'Consulta de ejemplo · hoy, 06:12'}</p></div></article>`;
}
function render() {
  const list = quotes(), winner = list[0], pinned = list.find(q => q.id === prefs.pinned);
  $('#trip-summary').textContent = `2 adultos · ${prefs.nightsMin}–${prefs.nightsMax} noches · ${prefs.countries.length} países posibles`;
  $('#window-summary').textContent = `Ida ${day(prefs.outMin)}–${day(prefs.outMax)} · vuelta ${day(prefs.backMin)}–${day(prefs.backMax)}`;
  $('#budget-summary').textContent = money(prefs.budget);
  $('#view-heading').textContent = view === 'saved' ? 'Los que te hicieron imaginar.' : 'Más cerca de despegar.';
  $('#view-eyebrow').textContent = view === 'saved' ? 'TUS OPCIONES GUARDADAS' : 'TU RADAR, DE UN VISTAZO';
  $('#saved-count').textContent = saved.size ? `(${saved.size})` : '';
  const visible = view === 'saved' ? [...saved.values()] : [winner, ...(pinned && pinned.id !== winner?.id ? [pinned] : [])].filter(Boolean);
  $('#cards').innerHTML = visible.length ? visible.map(q => ticket(q, view === 'radar' && q.id === winner?.id, q.id === prefs.pinned, winner?.price ?? q.price)).join('') : `<div class="empty-card"><i class="ph ${view === 'saved' ? 'ph-bookmark-simple' : 'ph-binoculars'}" aria-hidden="true"></i><h3>${view === 'saved' ? 'Un lugar para tus favoritos.' : 'El viaje empieza con una posibilidad.'}</h3><p>${view === 'saved' ? 'Guardá una opción desde el marcador de su tarjeta. Acá vas a poder volver a verla.' : `Todavía no hay cotizaciones de ejemplo para estas condiciones. ${countries[prefs.pinned].name} sigue fijado y aparecerá cuando tenga una observación válida.`}</p><button class="quiet" id="empty-action">${view === 'saved' ? 'Volver a mi viaje' : 'Revisar mis preferencias'} <i class="ph ph-arrow-right" aria-hidden="true"></i></button></div>`;
  $('#alternatives').hidden = view === 'saved' || !list.length;
  $('#country-list').innerHTML = list.filter(q => q.id !== winner?.id && q.id !== prefs.pinned).map(q => `<article class="country-row"><img src="assets/${q.photo}" alt="" width="42" height="46"><div><h3>${q.name}</h3><p>${q.city} · ${q.stops ? '1 escala' : 'Directo'}</p></div><div class="row-price"><strong>${money(q.price)}</strong><p>${q.price > prefs.budget ? 'Sobre tu máximo' : `+ ${money(q.price - winner.price)}`}</p></div><button class="round" data-pin="${q.id}" aria-label="Mostrar siempre ${q.name}" title="Mostrar siempre ${q.name}"><i class="ph ph-push-pin" aria-hidden="true"></i></button></article>`).join('') || '<p class="field-note">Ya estás viendo todos los países con cotizaciones de ejemplo.</p>';
  $('#monitor-title').textContent = scenario === 'blocked' ? 'La fuente necesita una pausa' : !list.length ? 'Tu viaje está configurado' : 'Tu viaje sigue en el radar';
  $('#monitor-message').textContent = scenario === 'blocked' ? 'Bloqueo simulado. Conservamos el último precio conocido, con su antigüedad. No confirma disponibilidad actual.' : !list.length ? 'Sin observaciones para estas condiciones en la demostración. Esto no significa que no existan vuelos.' : 'Ejemplo: 4 de 24 combinaciones consultadas. La cobertura es parcial.';
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === view; button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-detail]').forEach(detail => detail.addEventListener('toggle', () => detail.open ? openCards.add(detail.dataset.detail) : openCards.delete(detail.dataset.detail)));
  attachMotion();
}
$('#cards').addEventListener('click', event => {
  const save = event.target.closest('[data-save]');
  if (save) {
    const id = save.dataset.save, wasSaved = saved.has(id);
    if (wasSaved) saved.delete(id); else { const q = quotes().find(q => q.id === id); if (q) saved.set(id, { ...q }); }
    render(); toast(wasSaved ? 'Opción quitada de esta vista previa.' : 'Guardado en esta sesión de prueba.');
    document.querySelector(`[data-save="${id}"]`)?.focus({ preventScroll: true });
  }
  if (event.target.closest('[data-demo-book]')) toast('Es una tarifa de ejemplo. No hay una reserva real asociada.');
  if (event.target.closest('#empty-action')) { if (view === 'saved') { view = 'radar'; render(); } else openSettings(); }
});
$('#country-list').addEventListener('click', event => {
  const button = event.target.closest('[data-pin]'); if (!button) return;
  prefs.pinned = button.dataset.pin; render(); toast(`${countries[prefs.pinned].name} queda siempre visible.`);
  document.querySelector(`[data-save="${prefs.pinned}"]`)?.focus({ preventScroll: true });
});
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { view = button.dataset.view; render(); }));
$('#scenario').addEventListener('change', event => { scenario = event.target.value; render(); });
$('#motion').checked = !matchMedia('(prefers-reduced-motion: reduce)').matches;
$('#motion').addEventListener('change', event => document.body.classList.toggle('motion-off', !event.target.checked));
function attachMotion() {
  document.querySelectorAll('.ticket').forEach(card => {
    let frame;
    function reset() { cancelAnimationFrame(frame); card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); card.style.setProperty('--mx', '50%'); card.style.setProperty('--my', '0%'); }
    card.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse' || !$('#motion').checked || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { const r = card.getBoundingClientRect(); const x = Math.min(1,Math.max(0,(event.clientX-r.left)/r.width)), y = Math.min(1,Math.max(0,(event.clientY-r.top)/r.height)); card.style.setProperty('--rx', `${(0.5-y)*4}deg`); card.style.setProperty('--ry', `${(x-0.5)*4}deg`); card.style.setProperty('--mx', `${x*100}%`); card.style.setProperty('--my', `${y*100}%`); });
    });
    card.addEventListener('pointerleave', reset);
    card.addEventListener('pointerdown', event => { if (event.pointerType !== 'mouse' && $('#motion').checked && !matchMedia('(prefers-reduced-motion: reduce)').matches) card.style.scale = '.985'; });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) card.addEventListener(type, () => { card.style.scale = ''; });
  });
}
const form = $('#trip-form');
function values() {
  const data = new FormData(form);
  return { countries: data.getAll('country'), pinned: data.get('pinned'), budget: Number(data.get('budget')), target: Number(data.get('target')), nightsMin: Number(data.get('nightsMin')), nightsMax: Number(data.get('nightsMax')), outMin: data.get('outMin'), outMax: data.get('outMax'), backMin: data.get('backMin'), backMax: data.get('backMax') };
}
function updateForm() {
  const p = values(); const previous = $('#pinned-country').value || prefs.pinned;
  $('#pinned-country').replaceChildren(...p.countries.map(id => { const option = new Option(countries[id].name, id); option.selected = id === previous; return option; }));
  $('#live-summary').textContent = `${p.countries.length} países · ${p.nightsMin}–${p.nightsMax} noches · máximo ${money(p.budget)} para 2 adultos. Aviso por email debajo de ${money(p.target)}. Siempre visible: ${countries[$('#pinned-country').value]?.name || 'elegí un país'}.`;
}
function openSettings() {
  for (const [key,value] of Object.entries(prefs)) { const input = form.elements.namedItem(key); if (input && key !== 'countries' && key !== 'pinned') input.value = String(value); }
  form.querySelectorAll('[name=country]').forEach(input => input.checked = prefs.countries.includes(input.value));
  $('#pinned-country').replaceChildren(...prefs.countries.map(id => new Option(countries[id].name,id,false,id===prefs.pinned)));
  $('#form-error').textContent = ''; updateForm(); $('#settings').showModal();
}
document.querySelectorAll('.edit-trip,#dock-settings,#settings-top').forEach(button => button.addEventListener('click', openSettings));
$('.close-settings').addEventListener('click', () => $('#settings').close());
form.addEventListener('input', updateForm);
form.addEventListener('submit', event => {
  event.preventDefault(); const p = values();
  const days = (a,b) => Math.round((new Date(b)-new Date(a))/86400000);
  let error = '';
  if (!p.countries.length) error = 'Elegí al menos un país para el viaje.';
  else if (p.outMin > p.outMax || p.backMin > p.backMax) error = 'El inicio de cada ventana debe ser anterior a su final.';
  else if (p.nightsMin > p.nightsMax) error = 'El mínimo de noches no puede superar el máximo.';
  else if (days(p.outMin,p.backMax) < p.nightsMin || days(p.outMax,p.backMin) > p.nightsMax) error = 'Las ventanas de fechas no permiten esa cantidad de noches.';
  else if (p.target > p.budget) error = 'El precio de aviso debe ser igual o menor a tu máximo.';
  $('#form-error').textContent = error; if (error) return;
  prefs = p; $('#settings').close(); render(); toast('Preferencias aplicadas a la vista previa.');
});
function updateClock() {
  const now = new Date(); const candidates = [0,1].flatMap(offset => [9,21].map(hour => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()+offset,hour))));
  const next = candidates.find(date => date > now); const seconds = Math.max(0,Math.floor((next-now)/1000));
  $('#countdown').textContent = `${String(Math.floor(seconds/3600)).padStart(2,'0')} : ${String(Math.floor(seconds/60)%60).padStart(2,'0')} : ${String(seconds%60).padStart(2,'0')}`;
  $('#next-time').textContent = `${new Intl.DateTimeFormat('es-AR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Argentina/Buenos_Aires'}).format(next)} · hora de Argentina`;
}
render(); updateClock(); setInterval(updateClock,1000);
