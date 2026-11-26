// Northcrest Air's (fictional) route network. Two bases, Manchester and
// Edinburgh. Airports are real so the demo reads naturally; the airline,
// its schedule and its prices are invented.

export interface Airport {
  code: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
}

export const AIRPORTS: Record<string, Airport> = Object.fromEntries(
  (
    [
      ["MAN", "Manchester", "Manchester", "GB", 53.354, -2.275],
      ["EDI", "Edinburgh", "Edinburgh", "GB", 55.95, -3.373],
      ["GLA", "Glasgow", "Glasgow", "GB", 55.872, -4.433],
      ["ABZ", "Aberdeen", "Aberdeen", "GB", 57.202, -2.198],
      ["BFS", "Belfast International", "Belfast", "GB", 54.658, -6.216],
      ["JER", "Jersey", "St Helier", "JE", 49.208, -2.196],
      ["NQY", "Cornwall Newquay", "Newquay", "GB", 50.441, -4.995],
      ["DUB", "Dublin", "Dublin", "IE", 53.421, -6.27],
      ["AMS", "Amsterdam Schiphol", "Amsterdam", "NL", 52.31, 4.768],
      ["CDG", "Paris Charles de Gaulle", "Paris", "FR", 49.01, 2.548],
      ["NCE", "Nice Côte d'Azur", "Nice", "FR", 43.658, 7.216],
      ["FRA", "Frankfurt", "Frankfurt", "DE", 50.033, 8.571],
      ["MUC", "Munich", "Munich", "DE", 48.354, 11.786],
      ["BRU", "Brussels", "Brussels", "BE", 50.901, 4.484],
      ["ZRH", "Zurich", "Zurich", "CH", 47.465, 8.549],
      ["GVA", "Geneva", "Geneva", "CH", 46.238, 6.109],
      ["VIE", "Vienna", "Vienna", "AT", 48.11, 16.57],
      ["PRG", "Prague", "Prague", "CZ", 50.101, 14.26],
      ["BUD", "Budapest", "Budapest", "HU", 47.437, 19.256],
      ["WAW", "Warsaw Chopin", "Warsaw", "PL", 52.166, 20.967],
      ["CPH", "Copenhagen", "Copenhagen", "DK", 55.618, 12.656],
      ["OSL", "Oslo", "Oslo", "NO", 60.197, 11.1],
      ["ARN", "Stockholm Arlanda", "Stockholm", "SE", 59.652, 17.919],
      ["HEL", "Helsinki", "Helsinki", "FI", 60.317, 24.963],
      ["KEF", "Reykjavík Keflavík", "Reykjavík", "IS", 63.985, -22.605],
      ["MAD", "Madrid Barajas", "Madrid", "ES", 40.472, -3.561],
      ["BCN", "Barcelona", "Barcelona", "ES", 41.297, 2.078],
      ["PMI", "Palma de Mallorca", "Palma", "ES", 39.552, 2.739],
      ["IBZ", "Ibiza", "Ibiza", "ES", 38.873, 1.373],
      ["AGP", "Málaga", "Málaga", "ES", 36.675, -4.499],
      ["ALC", "Alicante", "Alicante", "ES", 38.282, -0.558],
      ["TFS", "Tenerife South", "Tenerife", "ES", 28.045, -16.572],
      ["LPA", "Gran Canaria", "Las Palmas", "ES", 27.932, -15.387],
      ["LIS", "Lisbon", "Lisbon", "PT", 38.781, -9.136],
      ["FAO", "Faro", "Faro", "PT", 37.014, -7.966],
      ["FCO", "Rome Fiumicino", "Rome", "IT", 41.8, 12.239],
      ["MXP", "Milan Malpensa", "Milan", "IT", 45.63, 8.723],
      ["ATH", "Athens", "Athens", "GR", 37.936, 23.947],
    ] as const
  ).map(([code, name, city, country, lat, lon]) => [code, { code, name, city, country, lat, lon }]),
);

/** Base, destination, daily rotations (each rotation is an out-and-back pair). */
export const ROUTES: ReadonlyArray<readonly [string, string, number]> = [
  ["MAN", "EDI", 5], ["MAN", "GLA", 4], ["MAN", "BFS", 3], ["MAN", "ABZ", 3],
  ["MAN", "JER", 2], ["MAN", "NQY", 1], ["MAN", "DUB", 4], ["MAN", "AMS", 4],
  ["MAN", "CDG", 4], ["MAN", "FRA", 3], ["MAN", "BRU", 2], ["MAN", "ZRH", 2],
  ["MAN", "GVA", 2], ["MAN", "MAD", 3], ["MAN", "BCN", 3], ["MAN", "LIS", 2],
  ["MAN", "FCO", 2], ["MAN", "MXP", 2], ["MAN", "MUC", 2], ["MAN", "CPH", 2],
  ["MAN", "OSL", 2], ["MAN", "ARN", 2], ["MAN", "HEL", 1], ["MAN", "VIE", 2],
  ["MAN", "PRG", 2], ["MAN", "BUD", 1], ["MAN", "WAW", 1], ["MAN", "ATH", 1],
  ["MAN", "PMI", 3], ["MAN", "AGP", 3], ["MAN", "ALC", 3], ["MAN", "FAO", 2],
  ["MAN", "TFS", 1], ["MAN", "LPA", 1], ["MAN", "IBZ", 1], ["MAN", "NCE", 2],
  ["EDI", "DUB", 2], ["EDI", "AMS", 3], ["EDI", "CDG", 2], ["EDI", "FRA", 2],
  ["EDI", "BCN", 1], ["EDI", "MAD", 1], ["EDI", "CPH", 1], ["EDI", "KEF", 1],
  ["EDI", "AGP", 2], ["EDI", "ALC", 1], ["EDI", "PMI", 1], ["EDI", "GVA", 1],
  ["EDI", "BRU", 1], ["EDI", "OSL", 1], ["EDI", "JER", 1], ["EDI", "BFS", 2],
];

/** Great-circle distance in km. */
export function distanceKm(a: Airport, b: Airport): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
}
