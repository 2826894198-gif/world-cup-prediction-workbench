import { existsSync } from 'node:fs';
import http from 'node:http';
import { URL } from 'node:url';
import { applySchema, dbPath, openDatabase } from './db/connection.mjs';
import { seedDatabase } from './db/seed.mjs';
import { Repository } from './services/repository.mjs';

const port = Number(process.env.API_PORT || 4177);
const db = openDatabase();
applySchema(db);

const teamCount = db.prepare('SELECT COUNT(*) AS count FROM teams').get().count;
if (!existsSync(dbPath) || teamCount === 0) {
  seedDatabase(db);
}

const repository = new Repository(db);

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function route(req, res) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { ok: true, dbPath });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/bootstrap') {
      sendJson(res, 200, {
        summary: repository.getSummary(),
        matches: repository.getMatches()
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/summary') {
      sendJson(res, 200, repository.getSummary());
      return;
    }

    if (req.method === 'GET' && pathname === '/api/matches') {
      sendJson(res, 200, repository.getMatches());
      return;
    }

    const matchDetail = pathname.match(/^\/api\/matches\/(\d+)$/);
    if (req.method === 'GET' && matchDetail) {
      const detail = repository.getMatchDetail(Number(matchDetail[1]));
      if (!detail) sendJson(res, 404, { error: 'Match not found' });
      else sendJson(res, 200, detail);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/refresh') {
      sendJson(res, 200, repository.refresh());
      return;
    }

    if (req.method === 'POST' && pathname === '/api/odds/refresh') {
      sendJson(res, 200, await repository.refreshOdds());
      return;
    }

    if (req.method === 'POST' && pathname === '/api/seed') {
      const input = await readBody(req);
      sendJson(res, 200, repository.seed(input));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/reviews') {
      const input = await readBody(req);
      sendJson(res, 201, repository.addReview(input));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/guesses') {
      sendJson(res, 200, repository.getPersonalGuesses());
      return;
    }

    if (req.method === 'POST' && pathname === '/api/guesses') {
      const input = await readBody(req);
      sendJson(res, 201, repository.addPersonalGuess(input));
      return;
    }

    const guessDetail = pathname.match(/^\/api\/guesses\/(\d+)$/);
    if (req.method === 'DELETE' && guessDetail) {
      sendJson(res, 200, repository.deletePersonalGuess(Number(guessDetail[1])));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/import') {
      const input = await readBody(req);
      sendJson(res, 202, repository.recordImport(input));
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message });
  }
}

const server = http.createServer(route);
server.listen(port, '127.0.0.1', () => {
  console.log(`World Cup prediction API listening on http://127.0.0.1:${port}`);
});

process.on('SIGTERM', () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
});
