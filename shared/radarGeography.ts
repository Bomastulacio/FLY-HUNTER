import catalog from './radar-geography.json' with { type: 'json' };

export const normalizeDestination = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toUpperCase();
const searches: Record<string, string[]> = catalog.searchAirports;
const groups = new Map(Object.entries(catalog.groups).map(([label, members]) => [normalizeDestination(label), members]));
const displayed = new Map(Object.entries(catalog.displayAirports).map(([label, airports]) => [normalizeDestination(label), airports]));
export const airportCatalog: Record<string, { country: string; city: string; scheduled: boolean }> =
  Object.fromEntries(Object.entries(catalog.airports).map(([code, values]) => [code,
    { country: String(values[0]), city: String(values[1]), scheduled: values[2] === 1 }]));
const countryAliases = new Map(Object.entries(catalog.countryAliases).flatMap(([code, names]) => names.map(n => [normalizeDestination(n), code] as const)));
const cities = new Map<string, string[]>();
const countries = new Map<string, string[]>();
for (const [code, airport] of Object.entries(airportCatalog)) {
  if (!airport.scheduled) continue;
  const key = normalizeDestination(airport.city);
  if (key) cities.set(key, [...(cities.get(key) || []), code]);
  countries.set(airport.country, [...(countries.get(airport.country) || []), code]);
}
for (const [city, codes] of cities) if (new Set(codes.map(c => airportCatalog[c].country)).size > 1) cities.delete(city);

/** Exact known airports never expand to nearby airports. Municipality is not a metro area. */
export function originAirports(value: string): string[] {
  return [...new Set(value.split(/[,/]/).flatMap(part => {
    const key = normalizeDestination(part);
    return airportCatalog[key] ? [key] : (catalog.metroAirports as Record<string, string[]>)[key] || cities.get(key) || [];
  }))];
}

/** Search coverage is explicit and bounded; display also accepts valid historical city airports. */
export function destinationAirports(target: string, purpose: 'search' | 'display' = 'display'): string[] {
  const key = normalizeDestination(target);
  const global = airportCatalog[key] ? [key] : (catalog.metroAirports as Record<string, string[]>)[key]
    || countries.get(countryAliases.get(key) || '') || cities.get(key) || [];
  if (purpose === 'search') return (catalog.metroAirports as Record<string, string[]>)[key] || searches[key] || global;
  return [...new Set([...(searches[key] || []), ...(displayed.get(key) || []),
    ...(groups.get(key) || []).flatMap(member => destinationAirports(member))])]
    .concat(global).filter((v, i, all) => all.indexOf(v) === i);
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
