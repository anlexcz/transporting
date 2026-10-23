CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  position geography(Point,4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS waypoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position geography(Point,4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code text NOT NULL,
  name text,
  color text NOT NULL DEFAULT '#2563eb',
  turnaround_a integer NOT NULL DEFAULT 5 CHECK (turnaround_a >= 0),
  turnaround_b integer NOT NULL DEFAULT 5 CHECK (turnaround_b >= 0)
);

CREATE TABLE IF NOT EXISTS line_directions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
  direction char(1) NOT NULL CHECK (direction IN ('A','B')),
  distance_m double precision NOT NULL DEFAULT 0,
  runtime_s double precision NOT NULL DEFAULT 0,
  geometry jsonb,
  UNIQUE(line_id, direction)
);

CREATE TABLE IF NOT EXISTS route_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_direction_id uuid NOT NULL REFERENCES line_directions(id) ON DELETE CASCADE,
  sort_order integer NOT NULL,
  point_type text NOT NULL CHECK (point_type IN ('stop','waypoint')),
  reference_id uuid NOT NULL,
  UNIQUE(line_direction_id, sort_order)
);

CREATE TABLE IF NOT EXISTS service_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
  name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  interval_minutes double precision,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL
);
