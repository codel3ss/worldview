import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { config as loadEnv } from 'dotenv';
import { feedRoutes } from './routes/feeds.js';
import { attachAisRelay } from './lib/aisRelay.js';
import { UpstreamError } from './lib/upstream.js';

loadEnv();

const env = { ...process.env, _startedAt: new Date().toISOString() };
const PORT = Number(env.PORT_PROXY || 8787);

const app = express();
app.disable('x-powered-by');

// This process holds the metered keys. It is meant to run on the same machine
// as the browser that talks to it; do not expose it to a network you do not
// control without putting auth in front.
app.use((req, res, next) => {
  res.set('referrer-policy', 'no-referrer');
  res.set('x-content-type-options', 'nosniff');
  next();
});

app.use('/api', feedRoutes(env));

// Serve the production build when it exists, so `npm start` is a single process.
const dist = path.join(process.cwd(), 'dist');
app.use(express.static(dist, { index: 'index.html', fallthrough: true }));


app.use((err, _req, res, _next) => {
  const status = err instanceof UpstreamError ? err.status : 500;
  if (status >= 500) console.error('[proxy]', err.message);
  res.status(status).json({ error: err.message ?? 'proxy failure' });
});

const server = http.createServer(app);
attachAisRelay(server, { apiKey: env.AISSTREAM_API_KEY, log: console });

server.listen(PORT, '127.0.0.1', () => {
  const configured = ['FIRMS_MAP_KEY', 'AISSTREAM_API_KEY', 'TOMTOM_API_KEY'].filter((k) => env[k]);
  console.log(`[proxy] http://127.0.0.1:${PORT}`);
  console.log(
    configured.length
      ? `[proxy] brokering: ${configured.join(', ')}`
      : '[proxy] no metered keys configured — zero-key layers only',
  );
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
