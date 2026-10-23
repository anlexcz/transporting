export type Id = string;
export type RoutePointType = 'stop' | 'waypoint';
export type DirectionCode = 'A' | 'B';

export interface Stop { id: Id; name: string; latitude: number; longitude: number; }
export interface Waypoint { id: Id; latitude: number; longitude: number; }
export interface RoutePoint { id?: Id; lineDirectionId?: Id; order: number; type: RoutePointType; referenceId: Id; }
export interface LineDirection { id: Id; lineId: Id; direction: DirectionCode; distance: number; runtime: number; geometry: GeoJSON.LineString | null; points: RoutePoint[]; }
export interface ServicePeriod { id: Id; lineId: Id; name: string; startTime: string; endTime: string; intervalMinutes: number | null; enabled: boolean; }
export interface Line { id: Id; publicCode: string; name: string | null; color: string; turnaroundA: number; turnaroundB: number; directions: LineDirection[]; servicePeriods: ServicePeriod[]; }
export interface AppState { stops: Stop[]; waypoints: Waypoint[]; lines: Line[]; }

export function cycleTimeSeconds(line: Line): number {
  const a = line.directions.find(d => d.direction === 'A')?.runtime ?? 0;
  const b = line.directions.find(d => d.direction === 'B')?.runtime ?? 0;
  return a + b + (line.turnaroundA + line.turnaroundB) * 60;
}

export function requiredVehicles(line: Line, period: ServicePeriod): number {
  if (!period.enabled || !period.intervalMinutes || period.intervalMinutes <= 0) return 0;
  return Math.ceil(cycleTimeSeconds(line) / (period.intervalMinutes * 60));
}
