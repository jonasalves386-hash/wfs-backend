'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SigaClient, SigaError } = require('../src/providers/SigaClient');
const {
  adaptSigaArrival,
  adaptSigaArrivals,
  normalizePaxDoorOpen,
  sigaDateTime,
  sanitizeShape,
} = require('../src/providers/SigaArrivalAdapter');
const { createProviders } = require('../src/providers');
const { MalhaProvider } = require('../src/providers/MalhaProvider');

const rawArrival = (changes = {}) => ({
  id: 'siga-operation-1',
  prefix: 'PR-MAG',
  number_arrival: 'LA3043',
  ori: 'BSB',
  eta_date: '29/09/2026',
  eta_time: '12:30',
  park_position_arrival: '305',
  engine_off: '',
  arrival_time: '',
  pax_door_open: '',
  status_flight_arrival: 'O',
  ...changes,
});

test('interpreta data/hora SIGA no fuso America/Sao_Paulo', () => {
  assert.equal(sigaDateTime('29/09/2026', '12:30'), '2026-09-29T15:30:00.000Z');
  assert.equal(sigaDateTime('31/02/2026', '12:30'), null);
  assert.equal(sigaDateTime('29/09/2026', '24:00'), null);
});

test('normaliza os campos reais de chegada sem expor payload bruto', () => {
  const arrival = adaptSigaArrival(rawArrival());
  assert.deepEqual(arrival, {
    id: 'siga-operation-1',
    aircraftPrefix: 'PR-MAG',
    serviceKey: '2026-09-29_3043',
    flightNumber: 'LA3043',
    origin: 'BSB',
    destination: null,
    eta: '2026-09-29T15:30:00.000Z',
    box: '305',
    paxDoorOpen: null,
    chocksOn: false,
    gateOpen: false,
    rawStatus: 'O',
  });
  assert.ok(!Object.hasOwn(arrival, 'dedup_key'));
});

test('mapeia calço e usa somente PAX DOOR OPEN para porta aberta', () => {
  assert.equal(adaptSigaArrival(rawArrival({ engine_off: '12:41' })).chocksOn, true);
  assert.equal(adaptSigaArrival(rawArrival({ arrival_time: '12:40' })).chocksOn, true);
  assert.deepEqual(adaptSigaArrival(rawArrival({ pax_door_open: '29/09/2026 12:43' })), {
    ...adaptSigaArrival(rawArrival()),
    paxDoorOpen: '12:43',
    gateOpen: true,
  });
  assert.equal(adaptSigaArrival(rawArrival({ bag_door_open: '29/09/2026 12:43' })).gateOpen, false);
});

test('normaliza PAX DOOR OPEN sem usar campos parecidos como fallback', () => {
  assert.equal(normalizePaxDoorOpen(' 29/09/2026 12:43 '), '12:43');
  assert.equal(normalizePaxDoorOpen('29/09/2026 12:43:59'), '12:43');
  assert.equal(normalizePaxDoorOpen('31/02/2026 12:43'), null);
  assert.equal(normalizePaxDoorOpen('12:43'), null);
});

test('aceita somente pernas de chegada com id e número e diagnostica ETA inválido', () => {
  const result = adaptSigaArrivals([
    rawArrival(),
    rawArrival({ id: 'sem-eta', eta_time: 'Invalid date' }),
    rawArrival({ id: 'somente-saida', number_arrival: '', number_departure: 'LA3044' }),
    null,
  ]);
  assert.equal(result.arrivals.length, 2);
  assert.deepEqual(result.diagnostics, { invalidRecords: 2, arrivalsWithoutValidEta: 1 });
});

test('amostra de estrutura sanitizada contém apenas nomes e tipos', () => {
  assert.deepEqual(sanitizeShape({ id: 'segredo-operacional', nested: { token: 'segredo' }, empty: null }), {
    empty: 'null', id: 'string', nested: 'object',
  });
});

test('client reutiliza endpoint e header aprovados no WFS-RETIRADAS', async () => {
  let call;
  const client = new SigaClient({
    baseUrl: 'https://siga.example/base/',
    apiKey: 'chave-de-teste',
    fetchImpl: async (url, options) => {
      call = { url, options };
      return { status: 200, json: async () => [rawArrival()] };
    },
  });
  assert.equal((await client.getFlightsSnapshot()).length, 1);
  assert.equal(call.url, 'https://siga.example/base/siga-flights/public');
  assert.deepEqual(call.options.headers, { 'x-api-key': 'chave-de-teste', Accept: 'application/json' });
  assert.equal(call.options.method, 'GET');
  assert.equal(call.options.redirect, 'error');
});

test('client sanitiza configuração, rede, HTTP e payload inválido', async () => {
  await assert.rejects(new SigaClient().getFlightsSnapshot(), (error) =>
    error instanceof SigaError && error.status === 503 && error.code === 'SIGA_NOT_CONFIGURED');

  const options = { baseUrl: 'https://siga.example', apiKey: 'segredo' };
  await assert.rejects(new SigaClient({ ...options, fetchImpl: async () => { throw new Error('não vazar'); } }).getFlightsSnapshot(),
    (error) => error.message === 'Não foi possível obter os voos SIGA.');
  await assert.rejects(new SigaClient({ ...options, fetchImpl: async () => ({ status: 401 }) }).getFlightsSnapshot(),
    (error) => error.status === 502 && !error.message.includes('segredo'));
  await assert.rejects(new SigaClient({ ...options, fetchImpl: async () => ({ status: 200, json: async () => ({}) }) }).getFlightsSnapshot(),
    (error) => error.code === 'SIGA_INVALID_RESPONSE');
});

test('SIGA real é o padrão; mock de voos exige flag explícita', () => {
  const silent = { warn() {}, error() {}, log() {} };
  assert.equal(createProviders({}, silent).modes.malha, 'siga-unconfigured');
  const configured = createProviders({ MALHA_BASE_URL: 'https://siga.example', SIGA_STREAM_API_KEY: 'x' }, silent);
  assert.equal(configured.modes.malha, 'siga');
  assert.equal(configured.malha.client.timeoutMs, 120000);
  assert.equal(createProviders({
    MALHA_BASE_URL: 'https://siga.example', SIGA_STREAM_API_KEY: 'x', SIGA_TIMEOUT_MS: '80000',
  }, silent).malha.client.timeoutMs, 80000);
  assert.equal(createProviders({ CHEGADAS_USE_MOCK_FLIGHTS: 'true' }, silent).modes.malha, 'mock-explicit');
});

test('Malha devolve cache real imediatamente enquanto atualiza em segundo plano', async () => {
  let calls = 0;
  let finishRefresh;
  const client = {
    isConfigured: () => true,
    getFlightsSnapshot: async () => {
      calls += 1;
      if (calls === 1) return [rawArrival()];
      return new Promise((resolve) => { finishRefresh = resolve; });
    },
  };
  const provider = new MalhaProvider({ client, logger: { warn() {}, error() {} } });

  const first = await provider.getArrivals();
  const cached = await provider.getArrivals();
  assert.equal(calls, 2);
  assert.deepEqual(cached, first);

  finishRefresh([rawArrival({ id: 'siga-operation-2', number_arrival: 'LA3044' })]);
  await provider.refresh();
  assert.equal((await provider.getArrivals())[0].id, 'siga-operation-2');
});

test('Malha mantém cache após falha e sinaliza dados antigos', async () => {
  let currentTime = 1000;
  let calls = 0;
  const errors = [];
  const client = {
    isConfigured: () => true,
    getFlightsSnapshot: async () => {
      calls += 1;
      if (calls === 1) return [rawArrival()];
      throw Object.assign(new Error('falha controlada'), { code: 'SIGA_UNAVAILABLE' });
    },
  };
  const provider = new MalhaProvider({
    client,
    staleAfterMs: 120000,
    now: () => currentTime,
    logger: { warn() {}, error: (...args) => errors.push(args) },
  });

  const first = await provider.getArrivals();
  assert.deepEqual(await provider.getArrivals(), first);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 1);
  assert.equal(provider.isCacheStale(), false);

  currentTime += 120001;
  assert.equal(provider.isCacheStale(), true);
  assert.deepEqual(await provider.getArrivals(), first);
});

test('Malha restaura em nova instância o último snapshot real persistido', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wfs-chegadas-cache-'));
  const cachePath = path.join(directory, 'malha-arrivals.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const writer = new MalhaProvider({
    client: { isConfigured: () => true, getFlightsSnapshot: async () => [rawArrival()] },
    cachePath,
    logger: { warn() {}, error() {} },
    now: () => 123456,
  });
  const expected = await writer.getArrivals();

  const reader = new MalhaProvider({
    client: { isConfigured: () => true, getFlightsSnapshot: async () => new Promise(() => {}) },
    cachePath,
    logger: { warn() {}, error() {} },
    now: () => 123456,
  });
  assert.deepEqual(await reader.getArrivals(), expected);
  assert.equal(reader.isCacheStale(), false);
});
