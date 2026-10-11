'use strict';

// Minimal local development server for Spring Atlas.
// It intentionally binds to loopback and invokes the same API handlers used by Vercel.
// Production authentication remains the responsibility of Vercel Deployment Protection.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { URL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const HOST = '127.0.0.1';
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function loadLocalEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const source = fs.readFileSync(envPath, 'utf8');
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadLocalEnv();
const PORT = Number.parseInt(process.env.PORT || '3000', 10);

const publicFiles = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/styles.css', 'styles.css'],
  ['/java-spring-backend-syllabus.json', 'java-spring-backend-syllabus.json'],
]);
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};
const handlerCache = new Map();

function json(res, status, body) {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function parseQuery(searchParams) {
  const query = Object.create(null);
  for (const [key, value] of searchParams) {
    if (Object.prototype.hasOwnProperty.call(query, key)) {
      query[key] = Array.isArray(query[key]) ? [...query[key], value] : [query[key], value];
    } else {
      query[key] = value;
    }
  }
  return query;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('request_body_too_large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!size) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch (_) {
    const error = new Error('invalid_json');
    error.statusCode = 400;
    throw error;
  }
}

function getApiHandler(pathname, query) {
  let filename;
  let conceptKey;
  if (pathname === '/api/health') filename = 'api/health.js';
  else if (pathname === '/api/bootstrap') filename = 'api/bootstrap.js';
  else if (pathname === '/api/migrate') filename = 'api/migrate.js';
  else if (pathname === '/api/progress') filename = 'api/progress/index.js';
  else if (pathname === '/api/notes') filename = 'api/notes/index.js';
  else {
    const match = pathname.match(/^\/api\/(progress|notes)\/([^/]+)\/?$/);
    if (!match) return null;
    try {
      conceptKey = decodeURIComponent(match[2]);
    } catch (_) {
      return null;
    }
    filename = `api/${match[1]}/[conceptKey].js`;
    query.conceptKey = conceptKey;
  }
  const resolved = path.join(ROOT, filename);
  if (!handlerCache.has(resolved)) handlerCache.set(resolved, require(resolved));
  return handlerCache.get(resolved);
}

async function handleApi(req, res, url) {
  const query = parseQuery(url.searchParams);
  let handler;
  try {
    handler = getApiHandler(url.pathname, query);
  } catch (_) {
    return json(res, 500, { error: 'server_error', message: 'The local API handler could not be loaded.' });
  }
  if (!handler) return json(res, 404, { error: 'not_found', message: 'API route not found.' });

  try {
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) req.body = await readBody(req);
    req.query = query;
    await handler(req, res);
  } catch (error) {
    if (error && error.statusCode === 413) return json(res, 413, { error: 'request_body_too_large', message: 'Request body exceeds the 4 MB local development limit.' });
    if (error && error.statusCode === 400) return json(res, 400, { error: 'invalid_json', message: 'Request body must be valid JSON.' });
    return json(res, 500, { error: 'server_error', message: 'The local request could not be completed.' });
  }
}

function serveStatic(res, pathname, method) {
  const filename = publicFiles.get(pathname);
  if (!filename) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Not found');
  }
  const fullPath = path.join(ROOT, filename);
  let stat;
  try {
    stat = fs.statSync(fullPath);
  } catch (_) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', mimeTypes[path.extname(filename)] || 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', filename.endsWith('.html') ? 'no-cache' : 'no-cache');
  if (method === 'HEAD') return res.end();
  fs.createReadStream(fullPath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  let url;
  try {
    url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  } catch (_) {
    return json(res, 400, { error: 'invalid_url', message: 'Request URL is invalid.' });
  }

  if (url.pathname.startsWith('/api/')) {
    return handleApi(req, res, url);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.statusCode = 405;
    return res.end('Method not allowed');
  }
  return serveStatic(res, url.pathname, req.method);
});

server.on('clientError', (_error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Spring Atlas local server: http://${HOST}:${PORT}\n`);
  process.stdout.write('Bound to localhost only. Set MONGODB_URI and MONGODB_DB_NAME in .env to enable cloud-backed API routes.\n');
  if (!process.env.MONGODB_URI || !process.env.MONGODB_DB_NAME) {
    process.stdout.write('Cloud database is not configured; API routes that need MongoDB will return 503.\n');
  }
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
