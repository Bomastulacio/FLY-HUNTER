/** Compact flight cards with progressive disclosure. No provider calls or UI framework. */
export const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

export const usd = (value: unknown) => `US$${new Intl.NumberFormat('es-AR', {
  maximumFractionDigits: 0,
}).format(Number(value) || 0)}`;

export function flightDate(value: string, year = false) {
  if (!value) return 'Fecha por confirmar';
  const day = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(day.getTime())) return 'Fecha por confirmar';
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}),
  }).format(day);
}

const cities: Record<string, string> = {
  MAD: 'Madrid', BCN: 'Barcelona', AGP: 'Málaga', VLC: 'Valencia',
  CDG: 'París', ORY: 'París', NCE: 'Niza', MRS: 'Marsella',
  FCO: 'Roma', MXP: 'Milán', LIN: 'Milán', NAP: 'Nápoles',
  LHR: 'Londres', LGW: 'Londres', MAN: 'Manchester', EDI: 'Edimburgo',
  FRA: 'Frankfurt', MUC: 'Múnich', BER: 'Berlín', DUS: 'Düsseldorf',
  LIS: 'Lisboa', OPO: 'Oporto', AMS: 'Ámsterdam', ZRH: 'Zúrich',
  GVA: 'Ginebra', ATH: 'Atenas', NRT: 'Tokio', HND: 'Tokio', KIX: 'Osaka',
  MIA: 'Miami', JFK: 'Nueva York', GRU: 'San Pablo', GIG: 'Río de Janeiro',
};

export function renderCompactFlight(deal: any, alert: any, featured = false, country = '', saved = false) {
  const e = escapeHtml;
  const [origin = '', destination = ''] = String(deal.ida_origen_destino || '').split('-').map(s => s.trim());
  const city = cities[destination] || destination || country || 'Vuelo';
  const passengers = Math.max(1, Number(deal.pasajeros || alert.pasajeros) || 1);
  const searchPassengers = Math.max(1, Number(alert.pasajeros) || passengers);
  const pax = `${passengers} adulto${passengers === 1 ? '' : 's'}`;
  const stops = Number(deal.cantidad_escalas);
  const stopText = Number.isFinite(stops) ? (stops === 0 ? 'Directo' : `${stops} escala${stops === 1 ? '' : 's'}`) : 'Escalas por confirmar';
  const gold = Boolean(deal.es_oportunidad_oro);
  const query = `Flights from ${origin} to ${destination} on ${deal.ida_fecha} through ${deal.vuelta_fecha} for ${searchPassengers} adults`;
  let bookingUrl = `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}&curr=USD&hl=es`;
  let provider = 'Google Flights';
  // Retain the winning OTA only when the stored URL belongs to that provider.
  if (deal.fuente === 'despegar' && deal.link_reserva) {
    try {
      const url = new URL(deal.link_reserva);
      if (url.protocol === 'https:' && /(^|\.)despegar\.(com|com\.ar)$/.test(url.hostname)) {
        bookingUrl = url.href;
        provider = 'Despegar';
      }
    } catch { /* Fall back to a passenger-aware search. */ }
  }
  const updated = deal.created_at ? new Date(deal.created_at) : null;
  const observation = updated && !Number.isNaN(updated.getTime())
    ? new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(updated)
    : 'Fecha de consulta no disponible';

  return `<article class="flight-item${featured ? ' flight-item--featured' : ''}" data-flight-id="${e(deal.id)}">
    <button class="flight-save" type="button" data-save-id="${e(deal.id)}"
      aria-label="${saved ? 'Quitar de guardados' : 'Guardar vuelo'} a ${e(city)}" aria-pressed="${saved}"
      title="${saved ? 'Quitar de guardados' : 'Guardar en este navegador'}">
      <i class="${saved ? 'ph-fill' : 'ph'} ph-bookmark-simple" aria-hidden="true"></i>
    </button>
    <details class="flight-disclosure">
      <summary class="flight-summary">
        <span class="flight-summary-top">
          <span class="flight-destination">${e(city)}</span>
          ${gold || featured ? `<span class="flight-badge">${gold ? 'Oportunidad de Oro' : 'Mejor precio'}</span>` : ''}
        </span>
        <span class="flight-route-line">${e(origin)} → ${e(destination)} · Ida y vuelta</span>
        <span class="flight-summary-facts">
          <span class="flight-dates">${e(flightDate(deal.ida_fecha))} → ${e(flightDate(deal.vuelta_fecha))}</span>
          <span class="flight-price">${e(usd(deal.precio_total_usd))}</span>
          <span class="flight-airline">${e(stopText)} · ${e(deal.aerolinea || 'Aerolínea por confirmar')}</span>
          <span class="flight-passengers">Total · ${e(pax)}</span>
        </span>
        <span class="flight-expand"><span class="when-closed">Ver vuelo</span><span class="when-open">Cerrar detalle</span><i class="ph ph-caret-down" aria-hidden="true"></i></span>
      </summary>
      <div class="flight-content">
        <dl class="flight-detail-grid">
          <div><dt>Ida</dt><dd>${e(deal.ida_origen_destino)}<small>${e(flightDate(deal.ida_fecha, true))}</small></dd></div>
          <div><dt>Vuelta</dt><dd>${e(deal.vuelta_origen_destino)}<small>${e(flightDate(deal.vuelta_fecha, true))}</small></dd></div>
        </dl>
        <a class="flight-book" href="${e(bookingUrl)}" target="_blank" rel="noopener noreferrer">Ver en ${provider}<i class="ph ph-arrow-up-right" aria-hidden="true"></i><span class="sr-only"> (abre otra pestaña)</span></a>
        <p class="flight-freshness">Consulta: ${e(observation)}. Confirmá precio y equipaje al abrir.</p>
        <details class="flight-explanation">
          <summary>Sobre esta oferta</summary>
          <p>${gold ? 'El radar la clasificó como Oportunidad de Oro.' : 'Oferta aprobada por el radar.'} Total registrado: ${e(usd(deal.precio_total_usd))}.</p>
          <p>${e(stopText)} · ${e(pax)}. El presupuesto de tu búsqueda es ${e(usd(alert.presupuesto_max))}.</p>
        </details>
        <a class="flight-edit" href="/alertas?radar=${encodeURIComponent(alert.id)}"><i class="ph ph-sliders-horizontal" aria-hidden="true"></i> Cambiar fechas o filtros</a>
      </div>
    </details>
  </article>`;
}
