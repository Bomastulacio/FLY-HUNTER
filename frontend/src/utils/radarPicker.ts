import { escapeHtml, usd } from './compactFlights';
import { supabase } from '../lib/supabase';

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

export function mountRadarPicker(
  container: HTMLElement,
  alerts: any[],
  selectedId: string,
  userId: string,
  onSelect: (id: string) => void,
  onRename?: (id: string, newName: string) => void
) {
  installDismissHandlers();
  const e = escapeHtml;
  let editingAlertId: string | null = null;

  const draw = (open = false, focusId = '') => {
    const primary = preferredRadarId(userId);
    const selected = alerts.find(a => a.id === selectedId) || alerts[0];
    if (!selected) { container.replaceChildren(); return; }
    const ordered = [...alerts].sort((a, b) => Number(b.id === primary) - Number(a.id === primary));

    container.innerHTML = `<details class="radar-picker" ${open ? 'open' : ''}>
      <summary aria-label="Cambiar radar. Actual: ${e(selected.nombre || selected.destino)}"><span class="radar-picker-icon"><i class="ph ph-broadcast" aria-hidden="true"></i></span>
        <span class="radar-picker-title"><small>Tu radar${selected.id === primary ? ' · Principal' : ''}</small><strong>${e(selected.nombre || selected.destino)}</strong></span>
        <span class="radar-picker-count">${alerts.length}</span><i class="ph ph-caret-down" aria-hidden="true"></i>
      </summary>
      <div class="radar-picker-menu"><p class="radar-picker-hint">Elegí un viaje · editá el nombre o marcá el principal</p>
        ${ordered.map(a => {
          if (editingAlertId === a.id) {
            return `<div class="radar-option is-editing is-selected">
              <form class="radar-rename-form" data-save-name-id="${e(a.id)}">
                <div class="radar-rename-input-wrap">
                  <i class="ph ph-tag" aria-hidden="true"></i>
                  <input type="text" class="radar-rename-input" value="${e(a.nombre || a.destino)}" maxlength="45" placeholder="Nombre del radar..." autofocus required />
                </div>
                <div class="radar-rename-actions">
                  <button type="submit" class="radar-rename-submit" title="Guardar nombre" aria-label="Guardar nombre"><i class="ph ph-check" aria-hidden="true"></i></button>
                  <button type="button" class="radar-rename-cancel" data-cancel-name-id="${e(a.id)}" title="Cancelar" aria-label="Cancelar"><i class="ph ph-x" aria-hidden="true"></i></button>
                </div>
              </form>
            </div>`;
          }

          return `<div class="radar-option${a.id === selected.id ? ' is-selected' : ''}">
            <button type="button" class="radar-option-select" data-radar-id="${e(a.id)}" aria-pressed="${a.id === selected.id}">
              <span><strong>${e(a.nombre || a.destino)}</strong><small>${e(a.origen)} → ${e(a.destino)} · Hasta ${e(usd(a.presupuesto_max))}</small></span>
              ${a.id === selected.id ? '<i class="ph ph-check" aria-hidden="true"></i>' : ''}
            </button>
            <button type="button" class="radar-rename-trigger" data-edit-name-id="${e(a.id)}" aria-label="Renombrar ${e(a.nombre || a.destino)}" title="Renombrar este radar">
              <i class="ph ph-pencil-simple" aria-hidden="true"></i>
            </button>
            <button type="button" class="radar-pin" data-pin-id="${e(a.id)}" aria-pressed="${a.id === primary}" aria-label="${a.id === primary ? 'Radar principal' : 'Hacer principal'}: ${e(a.nombre || a.destino)}" title="${a.id === primary ? 'Radar principal' : 'Mostrar primero al entrar'}"><i class="${a.id === primary ? 'ph-fill' : 'ph'} ph-star" aria-hidden="true"></i><span>${a.id === primary ? 'Principal' : 'Elegir principal'}</span></button>
          </div>`;
        }).join('')}
        <p class="radar-picker-note" role="status">El principal se recuerda en este navegador.</p>
      </div>
    </details>`;

    // Selección de radar
    container.querySelectorAll<HTMLButtonElement>('[data-radar-id]').forEach(button => {
      button.addEventListener('click', () => {
        selectedId = button.dataset.radarId!;
        editingAlertId = null;
        draw();
        onSelect(selectedId);
        container.querySelector('summary')?.focus();
      });
    });

    // Activar edición de nombre
    container.querySelectorAll<HTMLButtonElement>('[data-edit-name-id]').forEach(button => {
      button.addEventListener('click', (ev) => {
        ev.stopPropagation();
        editingAlertId = button.dataset.editNameId!;
        draw(true);
        const input = container.querySelector<HTMLInputElement>('.radar-rename-input');
        if (input) {
          input.focus();
          input.select();
        }
      });
    });

    // Cancelar edición
    container.querySelectorAll<HTMLButtonElement>('[data-cancel-name-id]').forEach(button => {
      button.addEventListener('click', (ev) => {
        ev.stopPropagation();
        editingAlertId = null;
        draw(true);
      });
    });

    // Guardar nuevo nombre
    container.querySelectorAll<HTMLFormElement>('[data-save-name-id]').forEach(form => {
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const id = form.dataset.saveNameId!;
        const input = form.querySelector<HTMLInputElement>('.radar-rename-input');
        const newName = (input?.value || '').trim();
        if (!newName) return;

        const targetAlert = alerts.find(a => a.id === id);
        if (targetAlert) {
          targetAlert.nombre = newName;
        }

        editingAlertId = null;
        draw(true);
        const noteEl = container.querySelector('.radar-picker-note');
        if (noteEl) noteEl.textContent = 'Guardando nombre...';

        try {
          const { error } = await supabase
            .from('search_alerts')
            .update({ nombre: newName })
            .eq('id', id);

          if (!error) {
            onRename?.(id, newName);
            const updatedNote = container.querySelector('.radar-picker-note');
            if (updatedNote) updatedNote.textContent = `Nombre actualizado: "${newName}"`;
          } else {
            console.error('Error al actualizar nombre en Supabase:', error);
            const errNote = container.querySelector('.radar-picker-note');
            if (errNote) errNote.textContent = 'No se pudo guardar el nombre en la base de datos.';
          }
        } catch (err) {
          console.error('Excepción al renombrar radar:', err);
        }
      });
    });

    // Fijar principal
    container.querySelectorAll<HTMLButtonElement>('[data-pin-id]').forEach(button => {
      button.addEventListener('click', () => {
        const id = button.dataset.pinId!;
        try {
          localStorage.setItem(preferenceKey(userId), id);
          selectedId = id;
          editingAlertId = null;
          draw(true, id);
          onSelect(id);
          container.querySelector('.radar-picker-note')!.textContent = id === primary
            ? 'Este ya es tu radar principal.' : 'Listo. Este radar aparecerá primero al entrar, en este navegador.';
        } catch {
          container.querySelector('.radar-picker-note')!.textContent = 'No pudimos guardar la preferencia en este navegador.';
        }
      });
      if (button.dataset.pinId === focusId) button.focus();
    });
  };
  draw();
}
