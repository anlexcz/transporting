type Coord = { latitude: number; longitude: number };

export interface RoutingResult {
  geometry: GeoJSON.LineString;
  distance: number;
  duration: number;
}

export interface RoutingProvider {
  route(points: Coord[]): Promise<RoutingResult>;
}

export class OsrmRoutingProvider implements RoutingProvider {
  constructor(private baseUrl = process.env.ROUTING_BASE_URL ?? 'https://router.project-osrm.org') {}

  async route(points: Coord[]): Promise<RoutingResult> {
    if (points.length < 2) throw new Error('Trasa potřebuje alespoň dva body.');
    const coords = points.map(p => `${p.longitude},${p.latitude}`).join(';');
    const url = `${this.baseUrl}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Routing selhal (${response.status}).`);
    const data = await response.json() as any;
    if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('Pro zadané body neexistuje sjízdná trasa.');
    return { geometry: data.routes[0].geometry, distance: data.routes[0].distance, duration: data.routes[0].duration };
  }
}
