#!/usr/bin/env node
import { applySchema, openDatabase } from '../server/db/connection.mjs';
import { ODDS_AUDIT_FILE, refreshMarketOdds } from '../server/services/oddsRefresh.mjs';

const db = openDatabase();
applySchema(db);

try {
  const audit = await refreshMarketOdds({ db });
  console.log(
    JSON.stringify(
      {
        status: audit.status,
        generatedAt: audit.generatedAt,
        targetWindow: audit.targetWindow,
        sources: audit.sources.map((source) => ({
          provider: source.provider,
          status: source.status,
          reachable: source.reachable,
          httpStatus: source.httpStatus,
          rowsSeen: source.rowsSeen,
          candidateRows: source.candidateRows,
          completeCandidates: source.completeCandidates,
          importedRows: source.importedRows
        })),
        importSummary: audit.importSummary,
        recommendationPolicy: audit.recommendationPolicy,
        auditFile: ODDS_AUDIT_FILE
      },
      null,
      2
    )
  );
} finally {
  db.close();
}
