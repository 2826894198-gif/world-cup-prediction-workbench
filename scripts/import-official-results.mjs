#!/usr/bin/env node

import { openDatabase, applySchema } from '../server/db/connection.mjs';
import { applyOfficialResults } from '../server/db/officialResults.mjs';
import { seedDatabase } from '../server/db/seed.mjs';

function currentDbMode(db) {
  const totalMatches = db.prepare('SELECT COUNT(*) AS count FROM matches').get().count;
  const sampleMatches = db
    .prepare("SELECT COUNT(*) AS count FROM matches WHERE status = 'sample_placeholder'")
    .get().count;
  return {
    totalMatches,
    sampleSandbox: totalMatches > 0 && sampleMatches === totalMatches
  };
}

const db = openDatabase();
applySchema(db);

try {
  const mode = currentDbMode(db);
  const result =
    mode.totalMatches !== 104 || mode.sampleSandbox
      ? {
          reseeded: true,
          ...seedDatabase(db, { mode: 'official' })
        }
      : {
          reseeded: false,
          ...applyOfficialResults(db)
        };

  console.log(JSON.stringify(result, null, 2));
} finally {
  db.close();
}
