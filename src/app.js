const express = require('express');
const cors    = require('cors');
const path = require('path');
const { createProviders } = require('./providers');
const { createPanelService } = require('./services/panelService');
const { SigaError } = require('./providers/SigaClient');

const app = express();
const providers = createProviders();
const panelService = createPanelService(providers);

// Várias TVs consultam a cada 60 s: requisições simultâneas ou muito próximas
// reaproveitam a mesma montagem do painel em vez de repetir Winglet/SIGA.
const RESPONSE_REUSE_MS = 10000;
let inFlight = null;
let lastResponse = null;

function loadPanel() {
  if (lastResponse && Date.now() - lastResponse.at < RESPONSE_REUSE_MS) {
    return Promise.resolve(lastResponse);
  }
  if (!inFlight) {
    inFlight = panelService.getPanelFlights()
      .then((voos) => {
        lastResponse = { voos, stale: panelService.isMalhaStale(), at: Date.now() };
        return lastResponse;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

// ─── CORS ────────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://project-0nqla.vercel.app',       // Vercel
  'https://jonasalves386-hash.github.io',    // GitHub Pages
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
].filter(Boolean);

app.use(cors({
  // Origem desconhecida apenas não recebe os headers CORS; a requisição não
  // vira erro 500 (o painel servido pelo próprio backend é same-origin).
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)),
  methods: ['GET'],
  exposedHeaders: ['X-Data-Stale'],
}));

// ─── ROTAS ───────────────────────────────────

async function getChegadas(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    const { voos, stale } = await loadPanel();
    res.set('X-Data-Stale', stale ? 'true' : 'false');
    return res.json(voos);
  } catch (err) {
    if (err instanceof SigaError) {
      return res.status(err.status).json({ erro: err.message, codigo: err.code });
    }
    console.error('[chegadas] Falha interna ao carregar voos.', err?.name || 'Error');
    return res.status(502).json({ erro: 'Não foi possível carregar os voos SIGA.', codigo: 'SIGA_UNAVAILABLE' });
  }
}

// /api/chegadas/voos: backend servindo o frontend direto.
// /chegadas/voos: proxy reverso (nginx) que remove o prefixo /api.
app.get(['/api/chegadas/voos', '/chegadas/voos'], getChegadas);
// Compatibilidade temporária com instalações anteriores; o frontend usa somente a rota acima.
app.get(['/voos', '/api/voos'], getChegadas);

app.get(['/health', '/api/health'], (req, res) => {
  res.json({ status: 'ok', providers: providers.modes, timestamp: new Date().toISOString() });
});

const frontendPath = process.env.FRONTEND_DIR
  ? path.resolve(process.env.FRONTEND_DIR)
  : path.resolve(__dirname, '../../front-end');
app.use(express.static(frontendPath));

module.exports = app;
