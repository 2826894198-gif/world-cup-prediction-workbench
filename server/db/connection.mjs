import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const dataDir = join(rootDir, 'data');
export const dbPath = join(dataDir, 'worldcup.sqlite');

export function openDatabase() {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

export function applySchema(db) {
  const schemaPath = join(rootDir, 'server', 'db', 'schema.sql');
  db.exec(readFileSync(schemaPath, 'utf8'));
}

export function json(value) {
  return JSON.stringify(value ?? null);
}

export function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

