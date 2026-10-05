import catalog from './radar-geography.json' with { type: 'json' };

export const normalizeDestination = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toUpperCase();
const searches: Record<string, string[]> = catalog.searchAirports;
const groups = new Map(Object.entries(catalog.groups).map(([label, members]) => [normalizeDestination(label), members]));
const displayed = new Map(Object.entries(catalog.displayAirports).map(([label, airports]) => [normalizeDestination(label), airports]));

/** Search coverage is explicit and bounded; display also accepts valid historical city airports. */
export function destinationAirports(target: string, purpose: 'search' | 'display' = 'display'): string[] {
  const key = normalizeDestination(target);
  if (purpose === 'search') return searches[key] || (/^[A-Z]{3}$/.test(key) ? [key] : []);
  return [...new Set([...(searches[key] || []), ...(displayed.get(key) || []),
    ...(groups.get(key) || []).flatMap(member => destinationAirports(member))])]
    .concat(/^[A-Z]{3}$/.test(key) ? [key] : []).filter((v, i, all) => all.indexOf(v) === i);
}

export function radarTargets(radar: { destino?: string; paises?: string[] }): string[] {
  return radar.paises?.length && !radar.paises.some(p => normalizeDestination(p) === 'CUALQUIERA')
    ? radar.paises : [radar.destino || ''];
}

/** Region names are legal in paises too: never treat Norteamérica as an unknown country. */
export function radarDestinationGroups(radar: { destino?: string; paises?: string[] }): string[] {
  return [...new Set(radarTargets(radar).flatMap(t => groups.get(normalizeDestination(t)) || [t]))];
}

export function radarAcceptsDestination(radar: { destino?: string; paises?: string[] }, airport: string): boolean {
  return radarTargets(radar).some(t => destinationAirports(t).includes(airport.toUpperCase().trim()));
}
