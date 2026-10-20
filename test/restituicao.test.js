'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PanelRules = require('../../front-end/panelRules');
const { RestituicaoProvider, adaptRestituicaoRecord } = require('../src/providers/RestituicaoProvider');
const { createProviders } = require('../src/providers');
const { createPanelService } = require('../src/services/panelService');
const { buildServiceKey } = require('../src/domain/panelRules');

const NOW = new Date('2026-10-20T15:00:00.000Z'); // 12:00 em São Paulo
const silent = { warn() {}, error() {}, log() {} };

const arrival = (id, flightNumber, minutes, extra = {}) => {
  const eta = new Date(NOW.getTime() + minutes * 60000).toISOString();
  return {
    id,
    flightNumber,
    origin: 'BSB',
    aircraftPrefix: 'PR-MAG',
    eta,
    serviceKey: buildServiceKey(eta, flightNumber.replace(/^\D+/, '')),
    paxDoorOpen: null,
    chocksOn: false,
    gateOpen: false,
    rawStatus: 'O',
    ...extra,
  };
};

const record = (changes = {}) => ({
  voo: '3255',
  companhia: 'LA',
  data: '2026-10-20',
  status: 'ESCALADO',
  equipe: 'DIAMANTE - T3',
  escalado: true,
  operador: null,
  ...changes,
});

function providerReturning(byDate, calls = []) {
  return new RestituicaoProvider({
    url: 'https://rest.example/integracao/chegadas',
    apiKey: 'chave-de-teste',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      const date = new URL(url).searchParams.get('data');
      return { status: 200, json: async () => byDate[date] || [] };
    },
  });
}

test('adapter: operador, depois equipe, depois "ESCALADO"; não escalado sem nome', () => {
  assert.equal(adaptRestituicaoRecord(record({ operador: 'JOAO - TRATOR' })).operatorName, 'JOAO - TRATOR');
  assert.equal(adaptRestituicaoRecord(record()).operatorName, 'DIAMANTE - T3');
  assert.equal(adaptRestituicaoRecord(record({ equipe: null })).operatorName, 'ESCALADO');
  const aguardando = adaptRestituicaoRecord(record({ status: 'AGUARDANDO', escalado: false, equipe: null }));
  assert.equal(aguardando.assigned, false);
  assert.equal(aguardando.operatorName, '');
  assert.equal(adaptRestituicaoRecord(record({ data: 'x' })), null);
});

test('consulta ?data= com x-api-key e casa por data + voo; sem registro = found:false', async () => {
  const calls = [];
  const provider = providerReturning({
    '2026-10-20': [record(), record({ voo: '3256', escalado: false, equipe: null, status: 'AGUARDANDO' })],
  }, calls);
  const result = await provider.getStatuses([
    arrival('a1', 'LA3255', 10),
    arrival('a2', 'LA3256', 10),
    arrival('a3', 'LA3257', 10),
  ]);
  assert.equal(new URL(calls[0].url).searchParams.get('data'), '2026-10-20');
  assert.equal(calls[0].options.headers['x-api-key'], 'chave-de-teste');
  assert.deepEqual(result.map((item) => [item.found, item.assigned, item.operatorName, item.holdUntilAssigned]), [
    [true, true, 'DIAMANTE - T3', true],
    [true, false, '', true],
    [false, false, '', true],
  ]);
});

test('dia anterior: ETA de 00:20 casa com a fila da véspera', async () => {
  const flight = { ...arrival('a1', 'LA3255', 0), eta: '2026-10-21T03:20:00.000Z' }; // 00:20 em SP
  const provider = providerReturning({ '2026-10-20': [record()] });
  const [result] = await provider.getStatuses([flight]);
  assert.equal(result.found, true);
  assert.equal(result.operatorName, 'DIAMANTE - T3');
});

test('erro HTTP e timeout viram erro tipado sem vazar a chave', async () => {
  const rejected = new RestituicaoProvider({ url: 'https://rest.example/x', apiKey: 'segredo', fetchImpl: async () => ({ status: 500 }) });
  await assert.rejects(rejected.getStatuses([arrival('a1', 'LA1', 5)]), (error) =>
    error.code === 'RESTITUICAO_REJECTED' && !error.message.includes('segredo'));

  const slow = new RestituicaoProvider({
    url: 'https://rest.example/x',
    apiKey: 'segredo',
    timeoutMs: 5,
    // Timer "ref" mantém o processo vivo até o sinal de timeout disparar.
    fetchImpl: () => new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('abort')), 50);
    }),
  });
  await assert.rejects(slow.getStatuses([arrival('a1', 'LA1', 5)]), (error) => error.code === 'RESTITUICAO_TIMEOUT');
});

test('env: REST_PROVIDER=restituicao liga a Restituição', () => {
  const providers = createProviders({
    REST_PROVIDER: 'restituicao',
    RESTITUICAO_API_URL: 'https://rest.example/integracao/chegadas',
    RESTITUICAO_API_KEY: 'x',
  }, silent);
  assert.equal(providers.modes.rest, 'restituicao');
  assert.equal(createProviders({ REST_PROVIDER: 'restituicao' }, silent).modes.rest, 'nao-integrada');
});

function serviceWith(statusFor, malhaFlights) {
  return createPanelService({
    malha: { getArrivals: async () => malhaFlights },
    rest: {
      isConfigured: () => true,
      getStatuses: async (flights) => flights.map((flight) => ({
        serviceKey: flight.serviceKey,
        holdUntilAssigned: true,
        ...statusFor(flight),
      })),
    },
  }, silent);
}

test('REST. sem escala segura o voo após o ETA por até 60 min', async () => {
  const panel = await serviceWith(() => ({ found: true, assigned: false, operatorName: '' }), [
    arrival('passou-10', 'LA1', -10),
    arrival('passou-70', 'LA2', -70),
    arrival('futuro', 'LA3', 20),
  ]).getPanelFlights(NOW);
  assert.deepEqual(panel.map((flight) => [flight.id, flight.held]), [['passou-10', true], ['futuro', false]]);
  assert.equal(PanelRules.restStatus(panel[0], NOW.getTime()), 'red');
});

test('REST. escalado ou sem registro não segura o voo', async () => {
  const panel = await serviceWith((flight) => (flight.id === 'escalado'
    ? { found: true, assigned: true, operatorName: 'DIAMANTE - T3' }
    : { found: false, assigned: false, operatorName: '' }), [
    arrival('escalado', 'LA1', -10),
    arrival('sem-registro', 'LA2', -10),
    arrival('futuro-escalado', 'LA3', 20),
  ]).getPanelFlights(NOW);
  assert.deepEqual(panel.map((flight) => flight.id), ['futuro-escalado']);
});

test('payload expõe operatorName e found:false vira cinza', async () => {
  const panel = await serviceWith((flight) => (flight.id === 'escalado'
    ? { found: true, assigned: true, operatorName: 'DIAMANTE - T3' }
    : { found: false, assigned: false, operatorName: '' }), [
    arrival('escalado', 'LA1', 3),
    arrival('sem-registro', 'LA2', 3),
  ]).getPanelFlights(NOW);
  const nowMs = NOW.getTime();
  assert.deepEqual(panel[0].rest, { integrated: true, assigned: true, operatorName: 'DIAMANTE - T3' });
  assert.equal(PanelRules.restStatus(panel[0], nowMs), 'blue');
  assert.equal(panel[1].rest.integrated, false);
  assert.equal(PanelRules.restStatus(panel[1], nowMs), 'gray');
});

test('cores REST. no frontend: cinza > 5 min, amarelo piscando <= 5, vermelho <= 0', () => {
  const nowMs = NOW.getTime();
  const at = (minutes, assigned = false) => ({
    eta: new Date(nowMs + minutes * 60000).toISOString(),
    rest: { integrated: true, assigned },
  });
  assert.equal(PanelRules.restStatus(at(10), nowMs), 'gray');
  assert.equal(PanelRules.restStatus(at(5), nowMs), 'yellow-blink');
  assert.equal(PanelRules.restStatus(at(1), nowMs), 'yellow-blink');
  assert.equal(PanelRules.restStatus(at(0), nowMs), 'red');
  assert.equal(PanelRules.restStatus(at(-15), nowMs), 'red');
  assert.equal(PanelRules.restStatus(at(-15, true), nowMs), 'blue');
});
