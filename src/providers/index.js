'use strict';

const path = require('path');
const { MalhaProvider } = require('./MalhaProvider');
const { RestProvider } = require('./RestProvider');
const { FoniaProvider } = require('./FoniaProvider');
const { MockProvider } = require('./MockProvider');
const { SigaClient } = require('./SigaClient');
const { WingletClient } = require('./WingletClient');
const { SmartFuelProvider } = require('./SmartFuelProvider');

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createProviders(env = process.env, logger = console) {
  const mock = new MockProvider();
  const timeoutMs = positiveInteger(env.PROVIDER_TIMEOUT_MS, 25000);
  const sigaTimeoutMs = positiveInteger(env.SIGA_TIMEOUT_MS, 120000);

  const sigaClient = new SigaClient({
    baseUrl: env.MALHA_BASE_URL,
    apiKey: env.SIGA_STREAM_API_KEY,
    timeoutMs: sigaTimeoutMs,
  });
  const realMalha = new MalhaProvider({
    client: sigaClient,
    logger,
    cachePath: path.resolve(__dirname, '../../.runtime-cache/malha-arrivals.json'),
    minRefreshIntervalMs: positiveInteger(env.MALHA_REFRESH_INTERVAL_MS, 30000),
    staleAfterMs: positiveInteger(env.MALHA_STALE_AFTER_MS, 300000),
  });
  // Mock é estritamente de desenvolvimento: só existe com a flag explícita e,
  // nesse caso, alimenta também Fonia e REST. para exercitar todas as cores.
  const useMock = env.CHEGADAS_USE_MOCK_FLIGHTS === 'true';
  if (useMock) logger.warn('[providers] Voos mockados ativados explicitamente para desenvolvimento.');

  const realRest = new RestProvider({
    baseUrl: env.REST_API_BASE_URL,
    token: env.REST_API_TOKEN,
    timeoutMs,
  });
  const useRealRest = env.REST_PROVIDER === 'api' && realRest.isConfigured();
  if (env.REST_PROVIDER === 'api' && !useRealRest) {
    logger.warn('[providers] REST. API solicitada, mas não configurada; linha REST. ficará cinza.');
  }

  const realFonia = new FoniaProvider({
    url: env.FONIA_API_URL,
    apiKey: env.INTEGRACAO_API_KEY_CHEGADA,
    timeoutMs,
  });

  const wingletClient = new WingletClient({
    baseUrl: env.WINGLET_API_BASE_URL || 'https://winglet.app/api',
    apiKey: env.WINGLET_API_KEY,
    timeoutMs,
  });
  const smartFuel = new SmartFuelProvider({ client: wingletClient, logger });

  let restMode = 'nao-integrada';
  if (useRealRest) restMode = 'api';
  else if (useMock) restMode = 'mock-explicit';

  return {
    malha: useMock ? mock : realMalha,
    fonia: useMock ? mock : realFonia,
    rest: useRealRest ? realRest : useMock ? mock : new RestProvider(),
    smartFuel,
    modes: {
      malha: useMock ? 'mock-explicit' : realMalha.isConfigured() ? 'siga' : 'siga-unconfigured',
      fonia: useMock ? 'mock-explicit' : realFonia.isConfigured() ? 'api' : 'nao-integrada',
      rest: restMode,
      smartFuel: smartFuel.isConfigured() ? 'winglet' : 'winglet-unconfigured',
    },
  };
}

module.exports = { createProviders };
