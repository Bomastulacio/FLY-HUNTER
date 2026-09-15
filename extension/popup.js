// Flight Hunter - Captura Personal Extractor (Popup Logic)
const captureProviders = {
  despegar: { name: 'Despegar', domain: 'despegar.' },
  aerolineas: { name: 'Aerolíneas Argentinas', domain: 'aerolineas.' },
  turismocity: { name: 'Turismocity', domain: 'turismocity.' },
};

function parseUsd(text) {
  const amount = String.raw`(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d+)*)`;
  const matches = [...text.matchAll(new RegExp(`(?:US\\$|USD)\\s*(${amount})|(${amount})\\s*(?:US\\$|USD)`, 'gi'))];
  if (matches.length !== 1) return undefined;
  let value = (matches[0][1] || matches[0][2]).replace(/\s/g, '');
  if (!/^\d+(?:[.,]\d+)*$/.test(value)) return undefined;
  const separator = value.match(/[.,](\d{1,2})$/);
  if (separator) {
    const last = value.lastIndexOf(separator[0][0]);
    const whole = value.slice(0, last);
    if (/[.,]/.test(whole) && !/^\d{1,3}(?:[.,]\d{3})+$/.test(whole)) return undefined;
    value = whole.replace(/[.,]/g, '') + '.' + separator[1];
  } else {
    if (/[.,]/.test(value) && !/^\d{1,3}(?:[.,]\d{3})+$/.test(value)) return undefined;
    value = value.replace(/[.,]/g, '');
  }
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function validDate(value) {
  return /^20\d{2}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

function dateFromText(text) {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const numeric = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  const named = text.match(/\b(\d{1,2})\s*(?:de\s+)?(ene\w*|feb\w*|mar\w*|abr\w*|may\w*|jun\w*|jul\w*|ago\w*|sep\w*|oct\w*|nov\w*|dic\w*)\.?\s*(?:de\s+)?(20\d{2})\b/i);
  const month = named ? ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'].indexOf(named[2].slice(0,3).toLowerCase()) + 1 : 0;
  const date = iso?.[1] || (numeric ? `${numeric[3]}-${numeric[2].padStart(2,'0')}-${numeric[1].padStart(2,'0')}`
    : named ? `${named[3]}-${String(month).padStart(2,'0')}-${named[1].padStart(2,'0')}` : '');
  return validDate(date) ? date : '';
}

function direction(text) {
  const airports = [...text.matchAll(/\b[A-Z]{3}\b/g)].map(m => m[0]).filter(code => !['USD','ARS','EUR','IDA'].includes(code));
  const stops = [...new Set([...text.matchAll(/\b(\d+)\s*escalas?\b|\b(?:directo|sin escalas)\b/gi)].map(m => m[1] ? Number(m[1]) : 0))];
  return { airports, date: dateFromText(text), stops: stops.length === 1 ? stops[0] : null };
}

function blankCapture(provider = 'despegar') {
  return {
    version: 1,
    sourceProvider: provider,
    observedAt: new Date().toISOString(),
    origin: '',
    destination: '',
    departureDate: '',
    returnDate: '',
    passengers: 2,
    totalUsd: null,
    airline: '',
    outboundStops: 1,
    returnStops: 1,
    paymentCondition: 'Con débito',
    baggage: 'Por confirmar'
  };
}

function draftFromVisibleText(provider, text, airlineNames = []) {
  const d = blankCapture(provider);
  if (provider === 'turismocity' || text.length > 20000 || /captcha|verific[aá].{0,12}humano|GPS perdi[oó]/i.test(text)) return d;
  const counts = [...new Set([...text.matchAll(/\b(?:final|total|para)\s+(\d+)\s*(?:personas?|adultos?|pasajeros?)\b|\b(\d+)\s*adultos?\b/gi)].map(m => Number(m[1] || m[2])))];
  d.passengers = counts.length === 1 && counts[0] > 0 && counts[0] <= 9 ? counts[0] : 2;
  if (d.passengers && /\b(?:final|total)\b/i.test(text) && !/por\s+(?:persona|adulto|pasajero)|por\s+tramo/i.test(text)) {
    d.totalUsd = parseUsd(text) ?? null;
  }
  const markers = [...text.matchAll(/\b(ida|vuelta|regreso)\b/gi)];
  const legs = markers.map((m, i) => ({ name: m[1].toLowerCase(), ...direction(text.slice(m.index + m[0].length, markers[i + 1]?.index)) }));
  const outbound = legs.filter(l => l.name === 'ida' && l.date && l.airports.length >= 2);
  const inbound = legs.filter(l => l.name !== 'ida' && l.date && l.airports.length >= 2);
  if (outbound.length === 1 && inbound.length === 1) {
    const a = outbound[0], b = inbound[0];
    if (a.airports[0] === b.airports[1] && a.airports[1] === b.airports[0]) {
      d.origin = a.airports[0];
      d.destination = a.airports[1];
      d.departureDate = a.date;
      d.returnDate = b.date;
      d.outboundStops = a.stops;
      d.returnStops = b.stops;
    }
  }
  d.airline = [...new Set(airlineNames.map(s => s.trim()).filter(s => s.length > 2 && s.length <= 80))].join(' / ').slice(0, 160);
  if (!d.airline && provider === 'aerolineas') d.airline = 'Aerolíneas Argentinas';
  if (/con d[eé]bito/i.test(text)) d.paymentCondition = 'Con débito';
  if (/pago en USD/i.test(text)) d.paymentCondition = 'Pago en USD';
  return d;
}

function captureErrors(d) {
  const errors = [];
  if (!d.sourceProvider || !captureProviders[d.sourceProvider]) errors.push('Elegí una fuente.');
  if (!/^[A-Z]{3}$/.test(d.origin) || !/^[A-Z]{3}$/.test(d.destination) || d.origin === d.destination) {
    errors.push('Completá dos aeropuertos IATA distintos (ej: EZE y MAD).');
  }
  if (!validDate(d.departureDate) || !validDate(d.returnDate) || d.returnDate <= d.departureDate) {
    errors.push('Revisá las fechas de ida y vuelta.');
  }
  if (!Number.isInteger(d.passengers) || d.passengers < 1 || d.passengers > 9) {
    errors.push('Indicá entre 1 y 9 adultos.');
  }
  if (!Number.isFinite(d.totalUsd) || d.totalUsd <= 0 || d.totalUsd >= 1000000) {
    errors.push('Indicá el precio total final del grupo en USD.');
  }
  if (![d.outboundStops, d.returnStops].every(s => s === 0 || s === 1)) {
    errors.push('Confirmá escalas (máximo 1 por tramo).');
  }
  if (!d.airline || !d.airline.trim()) {
    errors.push('Completá el nombre de la aerolínea.');
  }
  return errors;
}

// UI State
let activeTab = null;
let detectedProvider = null;

async function init() {
  const badge = document.getElementById('site-badge');
  const info = document.getElementById('status-info');
  const btnCapture = document.getElementById('btn-capture');

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || !tabs[0]) {
      badge.innerText = 'Sin pestaña';
      return;
    }
    activeTab = tabs[0];
    const url = activeTab.url || '';

    if (url.includes('despegar.com')) {
      detectedProvider = 'despegar';
      badge.innerText = 'Despegar detectado';
      badge.className = 'badge-status';
      info.innerHTML = 'Listo para extraer la cotización visible de <strong>Despegar</strong>.';
    } else if (url.includes('aerolineas.com')) {
      detectedProvider = 'aerolineas';
      badge.innerText = 'Aerolíneas detectado';
      badge.className = 'badge-status';
      info.innerHTML = 'Listo para extraer la cotización visible de <strong>Aerolíneas Argentinas</strong>.';
    } else if (url.includes('turismocity.com')) {
      detectedProvider = 'turismocity';
      badge.innerText = 'Turismocity (Manual)';
      badge.className = 'badge-status warning';
      info.innerHTML = '<strong>Turismocity</strong> es un metabuscador con tarifas redirigidas. Flight Hunter requiere carga manual para garantizar pasajeros y escalas exactas.';
    } else {
      detectedProvider = null;
      badge.innerText = 'Sitio no compatible';
      badge.className = 'badge-status warning';
      info.innerHTML = 'Navegá a los resultados de <strong>Despegar</strong> o <strong>Aerolíneas Argentinas</strong> para capturar automáticamente, o ingresá manualmente en /capturas.';
    }
  } catch (err) {
    badge.innerText = 'Error';
    console.error(err);
  }
}

document.getElementById('btn-capture')?.addEventListener('click', async () => {
  const form = document.getElementById('capture-form');
  const info = document.getElementById('status-info');

  if (!activeTab) return;

  if (detectedProvider === 'turismocity' || !detectedProvider) {
    // Abrir formulario para carga manual con valores iniciales
    populateForm(blankCapture(detectedProvider || 'despegar'));
    form.style.display = 'block';
    validateForm();
    return;
  }

  info.innerHTML = 'Extrayendo datos visibles de la pestaña...';

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: () => {
        // Ejecutado en contexto de la página
        const text = document.body.innerText || '';
        const images = Array.from(document.querySelectorAll('img[alt], [data-airline], span.airline-name'));
        const names = images.map(el => el.getAttribute('alt') || el.getAttribute('data-airline') || el.innerText || '').filter(Boolean);
        return { text: text.slice(0, 20000), names };
      }
    });

    if (!result || !result.result) {
      info.innerHTML = 'No se pudo leer la página activa.';
      return;
    }

    const { text, names } = result.result;
    const draft = draftFromVisibleText(detectedProvider, text, names);
    populateForm(draft);
    form.style.display = 'block';
    info.innerHTML = 'Revisá los datos extraídos abajo antes de descargar el JSON.';
    validateForm();
  } catch (e) {
    info.innerHTML = 'Error al ejecutar extracción: ' + (e.message || String(e));
  }
});

function populateForm(d) {
  document.getElementById('f-origin').value = d.origin || '';
  document.getElementById('f-destination').value = d.destination || '';
  document.getElementById('f-dep-date').value = d.departureDate || '';
  document.getElementById('f-ret-date').value = d.returnDate || '';
  document.getElementById('f-pax').value = d.passengers || 2;
  document.getElementById('f-total-usd').value = d.totalUsd || '';
  document.getElementById('f-airline').value = d.airline || '';
  document.getElementById('f-out-stops').value = d.outboundStops ?? '1';
  document.getElementById('f-ret-stops').value = d.returnStops ?? '1';
  document.getElementById('f-payment').value = d.paymentCondition || 'Con débito';
  document.getElementById('f-baggage').value = d.baggage || 'Por confirmar';
}

function getDraftFromForm() {
  return {
    version: 1,
    sourceProvider: detectedProvider || 'despegar',
    observedAt: new Date().toISOString(),
    origin: document.getElementById('f-origin').value.trim().toUpperCase(),
    destination: document.getElementById('f-destination').value.trim().toUpperCase(),
    departureDate: document.getElementById('f-dep-date').value,
    returnDate: document.getElementById('f-ret-date').value,
    passengers: Number(document.getElementById('f-pax').value) || 1,
    totalUsd: Number(document.getElementById('f-total-usd').value) || null,
    airline: document.getElementById('f-airline').value.trim(),
    outboundStops: Number(document.getElementById('f-out-stops').value),
    returnStops: Number(document.getElementById('f-ret-stops').value),
    paymentCondition: document.getElementById('f-payment').value.trim(),
    baggage: document.getElementById('f-baggage').value.trim()
  };
}

function validateForm() {
  const draft = getDraftFromForm();
  const errors = captureErrors(draft);
  const errBox = document.getElementById('form-errors');
  const successBox = document.getElementById('form-success');
  const btnDownload = document.getElementById('btn-download');

  if (errors.length) {
    errBox.style.display = 'block';
    errBox.innerHTML = errors.map(e => `• ${e}`).join('<br>');
    successBox.style.display = 'none';
    btnDownload.disabled = true;
    return false;
  } else {
    errBox.style.display = 'none';
    successBox.style.display = 'block';
    btnDownload.disabled = false;
    return true;
  }
}

['f-origin', 'f-destination', 'f-dep-date', 'f-ret-date', 'f-pax', 'f-total-usd', 'f-airline', 'f-out-stops', 'f-ret-stops', 'f-payment', 'f-baggage'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', validateForm);
});

document.getElementById('btn-download')?.addEventListener('click', () => {
  if (!validateForm()) return;
  const draft = getDraftFromForm();
  const jsonStr = JSON.stringify(draft, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const filename = `flight-hunter-${draft.sourceProvider}-${draft.origin}-${draft.destination}-${draft.departureDate}.json`;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

document.getElementById('link-open-capturas')?.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'http://localhost:4321/capturas' });
});

document.addEventListener('DOMContentLoaded', init);
