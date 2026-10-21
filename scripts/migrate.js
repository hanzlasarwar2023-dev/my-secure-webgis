'use strict';

/**
 * PU WebGIS - database schema bootstrap
 * ---------------------------------------------------------------
 * Nayi (cloud) PostgreSQL database ke liye tables banata hai.
 * Script idempotent hai - ise baar baar chalana safe hai.
 *
 *   npm run migrate
 *
 * PostGIS extension banani ho sakti hai. Supabase/Neon par extension
 * dashboard se enable karni hogi (SQL Editor mein wahi CREATE EXTENSION
 * chala dein).
 */

require('dotenv').config({ quiet: true });

const { Pool } = require('pg');

function buildDbConfig() {
  const wantSsl = process.env.DB_SSL
    ? !/^(false|0|no|off)$/i.test(process.env.DB_SSL.trim())
    : Boolean(process.env.DATABASE_URL);

  const base = {
    ssl: wantSsl ? { rejectUnauthorized: false } : false,
    max: 2,
    connectionTimeoutMillis: 15000,
    application_name: 'pu-webgis-migrate'
  };

  if (process.env.DATABASE_URL) {
    return Object.assign(base, { connectionString: process.env.DATABASE_URL });
  }
  return Object.assign(base, {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'Project 1',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || ''
  });
}

const STATEMENTS = [
  `CREATE EXTENSION IF NOT EXISTS postgis`,

  `CREATE TABLE IF NOT EXISTS public.users (
     id           SERIAL PRIMARY KEY,
     username     TEXT UNIQUE NOT NULL,
     password_hash TEXT NOT NULL,
     role         TEXT NOT NULL DEFAULT 'user',
     created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'`,
  `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`,

  `CREATE TABLE IF NOT EXISTS public.places (
     id          SERIAL PRIMARY KEY,
     name        TEXT NOT NULL,
     category    TEXT,
     description TEXT,
     geom        geometry(Geometry, 4326),
     created_by  INTEGER,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS public.lines (
     id          SERIAL PRIMARY KEY,
     name        TEXT NOT NULL,
     category    TEXT,
     description TEXT,
     geom        geometry(Geometry, 4326),
     created_by  INTEGER,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS public.polygons (
     id          SERIAL PRIMARY KEY,
     name        TEXT NOT NULL,
     category    TEXT,
     description TEXT,
     geom        geometry(Geometry, 4326),
     created_by  INTEGER,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS public.campus_boundary (
     id   SERIAL PRIMARY KEY,
     name TEXT,
     geom geometry(Polygon, 4326)
   )`,

  `CREATE INDEX IF NOT EXISTS idx_places_geom      ON public.places      USING GIST (geom)`,
  `CREATE INDEX IF NOT EXISTS idx_lines_geom       ON public.lines       USING GIST (geom)`,
  `CREATE INDEX IF NOT EXISTS idx_polygons_geom    ON public.polygons    USING GIST (geom)`,
  `CREATE INDEX IF NOT EXISTS idx_boundary_geom    ON public.campus_boundary USING GIST (geom)`,
  `CREATE INDEX IF NOT EXISTS idx_features_created ON public.places (created_by)`
];

(async function main() {
  const pool = new Pool(buildDbConfig());
  let failed = 0;

  try {
    for (const sql of STATEMENTS) {
      const label = sql.replace(/\s+/g, ' ').slice(0, 58);
      try {
        await pool.query(sql);
        console.log('  OK   ' + label);
      } catch (err) {
        failed++;
        console.warn('  FAIL ' + label);
        console.warn('       -> ' + err.message);
      }
    }

    if (failed === 0) {
      console.log('\n[done] Database tayyar hai.');
    } else {
      console.log('\n[warn] ' + failed + ' statement fail hui. Output dekhein.');
      console.log('[hint] PostGIS extension ke liye database admin se');
      console.log('       CREATE EXTENSION postgis; chala dein.');
    }
    process.exitCode = failed === 0 ? 0 : 1;
  } catch (err) {
    console.error('\n[fatal] Database se connect nahi ho sake: ' + err.message);
    console.error('        .env mein DATABASE_URL / DB_* check karein.');
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
})();
