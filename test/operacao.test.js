'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PanelRules = require('../../front-end/panelRules');
const { createProviders } = require('../src/providers');
const { MalhaProvider } = require('../src/providers/MalhaProvider');
const { createPanelService } = require('../src/services/panelService');
const { selectEligibleArrivals, saoPauloDateKey, buildServiceKey } = require('../src/domain/panelRules');

const NOW = new Date('2026-09-30T15:00:00.000Z');
const silent = { warn() {}, error() {}, log() {} };

const arrival = (id, minutes, extra = {}) => ({
  id,
  flightNumber: 'LA3043',
  origin: 'BSB',
  aircraftPrefix: 'PR-MAG',
  eta: new Date(NOW.getTime() + minutes * 60000).toISOString(),
  paxDoorOpen: null,
  chocksOn: false,
  gateOpen: false,
  rawStatus: 'O',
  ...extra,
});

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

test('produção: Fonia e REST. ficam não integradas, sem mock', () => {
  const providers = createProviders({ MALHA_BASE_URL: 'https://siga.example', SIGA_STREAM_API_KEY: 'x' }, silent);
  assert.equal(providers.modes.fonia, 'nao-integrada');
  assert.equal(providers.modes.rest, 'nao-integrada');
  assert.equal(providers.fonia.isConfigured(), false);
  assert.equal(providers.rest.isConfigured(), false);

  const legacyMock = createProviders({ REST_PROVIDER: 'mock' }, silent);
  assert.equal(legacyMock.modes.rest, 'nao-integrada');

  const restApi = createProviders({ REST_PROVIDER: 'api', REST_API_BASE_URL: 'https://rest.example' }, silent);
  assert.equal(restApi.modes.rest, 'api');

  const dev = createProviders({ CHEGADAS_USE_MOCK_FLIGHTS: 'true' }, silent);
  assert.equal(dev.modes.fonia, 'mock-explicit');
  assert.equal(dev.modes.rest, 'mock-explicit');
});

test('serviço não integrado não é chamado e sai como integrated=false', async () => {
  const providers = {
    malha: { getArrivals: async () => [arrival('a1', 3)] },
    fonia: { isConfigured: () => false, getAssignments: async () => assert.fail('Fonia não deve executar') },
    rest: { isConfigured: () => false, getStatuses: async () => assert.fail('REST não deve executar') },
    smartFuel: {
      isConfigured: () => true,
      getStatuses: async () => [{ operationId: 'a1', assigned: true, completed: false, teamName: 'JONAS - T3' }],
    },
  };
  const [flight] = await createPanelService(providers, silent).getPanelFlights(NOW);
  assert.deepEqual(flight.fonia, { integrated: false, teamName: '', inPosition: false });
  assert.deepEqual(flight.rest, { integrated: false, assigned: false });
  assert.equal(flight.smartFuel.integrated, true);
  assert.equal(flight.smartFuel.teamName, 'JONAS - T3');
});

test('linhas não integradas ficam cinza mesmo com voo a 2 minutos', () => {
  const nowMs = NOW.getTime();
  const flight = {
    eta: new Date(nowMs + 2 * 60000).toISOString(),
    fonia: { integrated: false, teamName: '', inPosition: false },
    rest: { integrated: false, assigned: false },
    smartFuel: { integrated: false, assigned: false, completed: false },
  };
  assert.equal(PanelRules.foniaStatus(flight, nowMs), 'gray');
  assert.equal(PanelRules.restStatus(flight, nowMs), 'gray');
  assert.equal(PanelRules.smartFuelStatus(flight, nowMs), 'gray');

  const integrated = { ...flight, smartFuel: { integrated: true, assigned: false, completed: false } };
  assert.equal(PanelRules.smartFuelStatus(integrated, nowMs), 'red');
});

test('Smart Fuel: falha curta mantém estado; falha prolongada vira cinza', async () => {
  let fail = false;
  const providers = {
    malha: { getArrivals: async () => [arrival('a1', 3)] },
    fonia: { isConfigured: () => false },
    rest: { isConfigured: () => false },
    smartFuel: {
      getStatuses: async () => {
        if (fail) throw new Error('falha controlada');
        return [{ operationId: 'a1', assigned: true, completed: true, teamName: 'ANA - T1' }];
      },
    },
  };
  const service = createPanelService(providers, silent, { maxEnrichmentAgeMs: 10 * 60000 });
  assert.equal((await service.getPanelFlights(NOW))[0].smartFuel.completed, true);

  fail = true;
  const shortly = new Date(NOW.getTime() + 60000);
  const [kept] = await service.getPanelFlights(shortly);
  assert.equal(kept.smartFuel.integrated, true);
  assert.equal(kept.smartFuel.completed, true);

  // O voo continua na janela porque a Malha mockada repete o mesmo ETA relativo.
  providers.malha.getArrivals = async () => [arrival('a1', 15)];
  const later = new Date(NOW.getTime() + 11 * 60000);
  const [expired] = await service.getPanelFlights(later);
  assert.deepEqual(expired.smartFuel, { integrated: false, assigned: false, completed: false, teamName: '' });
});

test('Smart Fuel sem estado anterior e com falha fica cinza, não vermelho', async () => {
  const providers = {
    malha: { getArrivals: async () => [arrival('a1', 3)] },
    smartFuel: { getStatuses: async () => { throw new Error('fora do ar'); } },
  };
  const [flight] = await createPanelService(providers, silent).getPanelFlights(NOW);
  assert.equal(flight.smartFuel.integrated, false);
  assert.equal(flight.fonia.integrated, false);
  assert.equal(flight.rest.integrated, false);
});

test('chegada cancelada (status C) não aparece no painel', () => {
  const selected = selectEligibleArrivals([
    arrival('cancelado', 5, { rawStatus: 'C' }),
    arrival('ativo', 6),
  ], NOW);
  assert.deepEqual(selected.map((item) => item.id), ['ativo']);
});

test('voo sem ETA não gera chave de serviço com data 1969', () => {
  assert.equal(saoPauloDateKey(null), '');
  assert.equal(buildServiceKey(null, '714'), '');
});

test('snapshot SIGA incompatível não apaga cache válido', async () => {
  let call = 0;
  const provider = new MalhaProvider({
    client: {
      isConfigured: () => true,
      getFlightsSnapshot: async () => {
        call += 1;
        return call === 1 ? [rawArrival()] : [{ campo_novo: 'x' }];
      },
    },
    logger: silent,
  });
  const first = await provider.getArrivals();
  assert.equal(first.length, 1);
  await assert.rejects(provider.refresh(), (error) => error.code === 'SIGA_INVALID_RESPONSE');
  assert.deepEqual(await provider.getArrivals(), first);
});

test('Malha respeita intervalo mínimo entre consultas à SIGA', async () => {
  let currentTime = 0;
  let calls = 0;
  const provider = new MalhaProvider({
    client: { isConfigured: () => true, getFlightsSnapshot: async () => { calls += 1; return [rawArrival()]; } },
    minRefreshIntervalMs: 30000,
    now: () => currentTime,
    logger: silent,
  });
  await provider.getArrivals();
  currentTime = 10000;
  await provider.getArrivals();
  await provider.getArrivals();
  assert.equal(calls, 1);

  currentTime = 31000;
  await provider.getArrivals();
  await provider.refreshPromise;
  assert.equal(calls, 2);
});
