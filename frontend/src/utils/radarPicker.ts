import { escapeHtml, usd } from './compactFlights';

const preferenceKey = (userId: string) => `fh_primary_radar_v1:${userId}`;
let dismissHandlersInstalled = false;

function installDismissHandlers() {
  if (dismissHandlersInstalled) return;
  dismissHandlersInstalled = true;
  document.addEventListener('pointerdown', event => {
    document.querySelectorAll<HTMLDetailsElement>('.radar-picker[open], .radar-overflow[open]').forEach(menu => {
      if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    });
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll<HTMLDetailsElement>('.radar-picker[open], .radar-overflow[open]').forEach(menu => {
      menu.open = false;
      if (menu.contains(document.activeElement)) menu.querySelector('summary')?.focus();
    });
  });
}

/** Presentation preference only: never changes the search schedule or API budget. */
export function preferredRadarId(userId: string): string | null {
  try { return localStorage.getItem(preferenceKey(userId)); } catch { return null; }
}

export function mountRadarPicker(container: HTMLElement, alerts: any[], selectedId: string,
  userId: string, onSelect: (id: string) => void) {
  installDismissHandlers();
  const e = escapeHtml;
  const draw = (open = false, focusId = '') => {
    const primary = preferredRadarId(userId);
    const selected = alerts.find(a => a.id === selectedId) || alerts[0];
    if (!selected) { container.replaceChildren(); return; }
    const ordered = [...alerts].sort((a, b) => Number(b.id === primary) - Number(a.id === primary));
    container.innerHTML = `<details class="radar-picker" ${open ? 'open' : ''}>
      <summary><span class="radar-picker-icon"><i class="ph ph-broadcast" aria-hidden="true"></i></span>
        <span class="radar-picker-title"><small>Tu radar${selected.id === primary ? ' · Principal' : ''}</small><strong>${e(selected.nombre || selected.destino)}</strong></span>
        <span class="radar-picker-count">${alerts.length}</span><i class="ph ph-caret-down" aria-hidden="true"></i>
      </summary>
      <div class="radar-picker-menu"><p class="radar-picker-hint">Elegí un viaje · marcá con estrella tu principal</p>
        ${ordered.map(a => `<div class="radar-option${a.id === selected.id ? ' is-selected' : ''}">
          <button type="button" class="radar-option-select" data-radar-id="${e(a.id)}" aria-pressed="${a.id === selected.id}">
            <span><strong>${e(a.nombre || a.destino)}</strong><small>${e(a.origen)} → ${e(a.destino)} · Hasta ${e(usd(a.presupuesto_max))}</small></span>
            ${a.id === selected.id ? '<i class="ph ph-check" aria-hidden="true"></i>' : ''}
          </button>
          <button type="button" class="radar-pin" data-pin-id="${e(a.id)}" aria-pressed="${a.id === primary}" aria-label="${a.id === primary ? 'Quitar principal' : 'Hacer principal'}: ${e(a.nombre || a.destino)}" title="${a.id === primary ? 'Radar principal' : 'Mostrar primero al entrar'}"><i class="${a.id === primary ? 'ph-fill' : 'ph'} ph-star" aria-hidden="true"></i></button>
        </div>`).join('')}
        <p class="radar-picker-note" role="status">El principal se recuerda en este navegador.</p>
      </div>
    </details>`;
    container.querySelectorAll<HTMLButtonElement>('[data-radar-id]').forEach(button => {
      button.addEventListener('click', () => {
        selectedId = button.dataset.radarId!;
        draw();
        onSelect(selectedId);
        container.querySelector('summary')?.focus();
      });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-pin-id]').forEach(button => {
      button.addEventListener('click', () => {
        const id = button.dataset.pinId!;
        try {
          if (id === primary) localStorage.removeItem(preferenceKey(userId));
          else localStorage.setItem(preferenceKey(userId), id);
          draw(true, id);
          container.querySelector('.radar-picker-note')!.textContent = id === primary
            ? 'Quitaste el radar principal.' : 'Listo. Este radar aparecerá primero al entrar, en este navegador.';
        } catch {
          container.querySelector('.radar-picker-note')!.textContent = 'No pudimos guardar la preferencia en este navegador.';
        }
      });
      if (button.dataset.pinId === focusId) button.focus();
    });
  };
  draw();
}
