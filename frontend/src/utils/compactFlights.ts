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

/** A total quoted for one adult must never be compared with a two-adult radar. */
export function matchesRadar(deal: any, radar: any): boolean {
  const [origin] = String(deal.ida_origen_destino || '').split('-');
  const origins = String(radar.origen || '').split(/[,/]/).map(s => s.trim());
  const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const excluded = Array.isArray(radar.aerolineas_excluidas) ? radar.aerolineas_excluidas : [];
  const stops = deal.cantidad_escalas;
  return origins.includes(origin) && Number(deal.pasajeros) === Number(radar.pasajeros)
    && stops != null && Number.isInteger(Number(stops)) && Number(stops) >= 0 && Number(stops) <= Math.min(1, Number(radar.escalas_max ?? 1))
    && Number(deal.precio_total_usd) > 0 && Number(deal.precio_total_usd) <= Number(radar.presupuesto_max)
    && (Number(deal.precio_total_usd) < 750 * Number(radar.pasajeros) || Number(deal.precio_total_usd) >= Number(radar.presupuesto_min || 0))
    && !excluded.some((a: string) => a.trim() && normalize(String(deal.aerolinea || '')).includes(normalize(a)))
    && (!radar.fecha_ida_min || deal.ida_fecha >= radar.fecha_ida_min)
    && (!(radar.fecha_ida_max || radar.fecha_ida_min) || deal.ida_fecha <= (radar.fecha_ida_max || radar.fecha_ida_min))
    && (!radar.fecha_vuelta_min || deal.vuelta_fecha >= radar.fecha_vuelta_min)
    && (!(radar.fecha_vuelta_max || radar.fecha_vuelta_min) || deal.vuelta_fecha <= (radar.fecha_vuelta_max || radar.fecha_vuelta_min));
}

export function renderCompactFlight(deal: any, alert: any, featured = false, country = '', saved = false) {
  const e = escapeHtml;
  const rawOD = String(deal.ida_origen_destino || `${deal.origen || 'EZE'}-${deal.destino || 'Vuelo'}`);
  const [origin = '', destination = ''] = rawOD.split('-').map(s => s.trim());
  const city = cities[destination] || destination || country || 'Vuelo';
  const passengers = Math.max(1, Number(deal.pasajeros ?? alert?.pasajeros) || 1);
  const searchPassengers = passengers;
  const pax = `${passengers} adulto${passengers === 1 ? '' : 's'}`;
  const unitPrice = passengers > 1 ? (Number(deal.precio_por_pasajero_usd) || Math.round(Number(deal.precio_total_usd) / passengers)) : null;
  const stops = Number(deal.cantidad_escalas);
  const stopText = deal.cantidad_escalas != null && Number.isFinite(stops) ?
    `${deal.detalle_cotizacion?.itineraryScope === 'search_result' ? 'Ida: ' : ''}${stops === 0 ? 'Directo' : `${stops} escala${stops === 1 ? '' : 's'}`}` : 'Escalas por confirmar';
  const gold = Boolean(deal.es_oportunidad_oro);
  const isSavedSnapshot = Boolean(deal.guardado_el);
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
  const dateToFormat = deal.detalle_cotizacion?.observedAt || deal.created_at || deal.guardado_el;
  const updated = dateToFormat ? new Date(dateToFormat) : null;
  const observation = updated && !Number.isNaN(updated.getTime())
    ? new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(updated)
    : 'Fecha de consulta no disponible';

  return `<article class="flight-item${featured ? ' flight-item--featured' : ''}${isSavedSnapshot ? ' flight-item--saved' : ''}" data-flight-id="${e(deal.id)}">
    <button class="flight-save" type="button" data-save-id="${e(deal.id)}"
      aria-label="${saved ? 'Quitar de guardados' : 'Guardar vuelo'} a ${e(city)}" aria-pressed="${saved}"
      title="${saved ? 'Quitar de guardados' : 'Guardar vuelo en tu cuenta'}">
      <i class="${saved ? 'ph-fill' : 'ph'} ph-bookmark-simple" aria-hidden="true"></i>
    </button>
    <details class="flight-disclosure">
      <summary class="flight-summary">
        <span class="flight-summary-top">
          <span class="flight-destination">${e(city)}</span>
          ${isSavedSnapshot ? `<span class="flight-badge" style="background:#4ade8022;color:#86efac;border-color:#4ade8044;"><i class="ph-fill ph-bookmark-simple"></i> Guardado</span>` : (gold || featured ? `<span class="flight-badge">${gold ? 'Oportunidad de Oro' : 'Mejor precio'}</span>` : '')}
        </span>
        <span class="flight-route-line">${e(country || 'Vuelo internacional')} · Ida y vuelta</span>
        <span class="ticket-route" aria-label="${e(origin)} a ${e(destination)}">
          <span>${e(origin)}</span><span class="ticket-route-track"><i class="ph ph-airplane-tilt" aria-hidden="true"></i></span><span>${e(destination)}</span>
        </span>
        <span class="flight-summary-facts">
          <span class="flight-dates"><small>Fechas</small>${e(flightDate(deal.ida_fecha))} — ${e(flightDate(deal.vuelta_fecha))}</span>
          <span class="flight-price">${e(usd(deal.precio_total_usd))}</span>
          <span class="flight-airline">${e(stopText)} · ${e(deal.aerolinea || 'Aerolínea por confirmar')}</span>
          <span class="flight-passengers">Total · ${e(pax)}${unitPrice ? ` (${e(usd(unitPrice))}/u)` : ''}</span>
        </span>
        <span class="flight-expand"><span class="when-closed">Ver vuelo</span><span class="when-open">Cerrar detalle</span><i class="ph ph-caret-down" aria-hidden="true"></i></span>
      </summary>
      <div class="flight-content">
        <dl class="flight-detail-grid">
          <div><dt>Ida</dt><dd>${e(deal.ida_origen_destino || `${origin}-${destination}`)}<small>${e(flightDate(deal.ida_fecha, true))}</small></dd></div>
          <div><dt>Vuelta</dt><dd>${e(deal.vuelta_origen_destino || `${destination}-${origin}`)}<small>${e(flightDate(deal.vuelta_fecha, true))}</small></dd></div>
        </dl>
        <a class="flight-book" href="${e(bookingUrl)}" target="_blank" rel="noopener noreferrer">Ver en ${provider}<i class="ph ph-arrow-up-right" aria-hidden="true"></i><span class="sr-only"> (abre otra pestaña)</span></a>
        ${deal.detalle_cotizacion?.paymentCondition ? `<p class="flight-freshness"><strong>${e(deal.detalle_cotizacion.paymentCondition)}</strong></p>` : ''}
        <p class="flight-freshness">Consulta: ${e(observation)}. Confirmá precio, horarios y equipaje al abrir.</p>
        <details class="flight-explanation">
          <summary>Sobre esta oferta</summary>
          <p>${isSavedSnapshot ? `Cotización guardada por vos a ${e(usd(deal.precio_total_usd))} para ${e(pax)}.` : (gold ? 'El radar la clasificó como Oportunidad de Oro.' : 'Oferta aprobada por el radar.')} Total registrado: ${e(usd(deal.precio_total_usd))}.</p>
          <p>${e(stopText)} · ${e(pax)}${alert?.presupuesto_max ? `. El presupuesto de tu búsqueda es ${e(usd(alert.presupuesto_max))}.` : '.'}</p>
          ${deal.detalle_cotizacion?.itineraryScope === 'search_result' ? '<p>Precio observado en la búsqueda de ida y vuelta. Revisá los tramos de regreso antes de reservar.</p>' : ''}
        </details>
        ${alert?.id ? `<a class="flight-edit" href="/alertas?radar=${encodeURIComponent(alert.id)}"><i class="ph ph-sliders-horizontal" aria-hidden="true"></i> Cambiar fechas o filtros</a>` : ''}
      </div>
    </details>
  </article>`;
}
