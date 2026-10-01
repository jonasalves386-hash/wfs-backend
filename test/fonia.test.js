'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PanelRules = require('../../front-end/panelRules');
const { FoniaProvider, adaptFoniaRecord, normalizeFlightNumber } = require('../src/providers/FoniaProvider');
const { createProviders } = require('../src/providers');
const { createPanelService } = require('../src/services/panelService');

const NOW = new Date('2026-10-01T15:00:00.000Z'); // 12:00 em São Paulo
const silent = { warn() {}, error() {}, log() {} };

const arrival = (id, flightNumber, minutes, extra = {}) => ({
  id,
  flightNumber,
  origin: 'BSB',
  aircraftPrefix: 'PR-MAG',
  eta: new Date(NOW.getTime() + minutes * 60000).toISOString(),
  paxDoorOpen: null,
  chocksOn: false,
  gateOpen: false,
  rawStatus: 'O',
  ...extra,
});

const record = (changes = {}) => ({
  id: 'r1',
  prefixo: 'PRMAG',
  voo: '3043',
  data: '2026-10-01',
  origem: 'BSB',
  sta: '2026-10-01T15:10:00.000Z',
  escalado: true,
  equipe: { id: 'e1', nome: 'VICTOR - T4', cor: 'AZUL' },
  apoio: null,
  na_posicao: false,
  iniciada: false,
  finalizada: false,
  cancelado: false,
  ...changes,
});

function providerReturning(byDate, calls = []) {
  return new FoniaProvider({
    url: 'https://fonia.example/integracao/chegadas/escalados',
    apiKey: 'chave-de-teste',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      const date = new URL(url).searchParams.get('data');
      return { status: 200, json: async () => byDate[date] || [] };
    },
  });
}

test('normaliza número do voo da Malha e da Fonia para o mesmo formato', () => {
  assert.equal(normalizeFlightNumber('LA3043'), '3043');
  assert.equal(normalizeFlightNumber('03043'), '3043');
  assert.equal(normalizeFlightNumber('LA 607'), '607');
  assert.equal(normalizeFlightNumber('3043'), '3043');
});

test('adapta escalado, na posição e ignora cancelado', () => {
  assert.equal(adaptFoniaRecord(record()).teamName, 'VICTOR - T4');
  assert.equal(adaptFoniaRecord(record()).inPosition, false);
  assert.equal(adaptFoniaRecord(record({ na_posicao: true })).inPosition, true);
  assert.equal(adaptFoniaRecord(record({ cancelado: true })), null);
  const semEquipe = adaptFoniaRecord(record({ escalado: false, equipe: null }));
  assert.equal(semEquipe.teamName, '');
  assert.equal(semEquipe.inPosition, false);
});

test('consulta ?data= do dia com x-api-key e casa por data + voo', async () => {
  const calls = [];
  const provider = providerReturning({
    '2026-10-01': [
      record(),
      record({ voo: '3044', equipe: { nome: 'ALFA - T1' }, na_posicao: true }),
      record({ voo: '9999', equipe: { nome: 'OUTRO' } }),
    ],
  }, calls);

  const result = await provider.getAssignments([
    arrival('a1', 'LA3043', 10),
    arrival('a2', 'LA3044', 20),
    arrival('a3', 'LA3045', 30),
  ]);

  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).searchParams.get('data'), '2026-10-01');
  assert.equal(calls[0].options.headers['x-api-key'], 'chave-de-teste');
  assert.deepEqual(result.map((item) => [item.operationId, item.teamName, item.inPosition]), [
    ['a1', 'VICTOR - T4', false],
    ['a2', 'ALFA - T1', true],
    ['a3', '', false],
  ]);
});

test('não usa registro do mesmo voo de outro dia', async () => {
  const provider = providerReturning({
    '2026-10-01': [record({ data: '2026-09-30', sta: '2026-09-30T15:10:00.000Z' })],
  });
  const [result] = await provider.getAssignments([arrival('a1', 'LA3043', 10)]);
  assert.equal(result.teamName, '');
});

test('virada de dia: ETA de 00:20 casa com registro da véspera pelo STA', async () => {
  // 23:30 em São Paulo; voo previsto 23:50 atrasou para 00:20 do dia seguinte.
  const now = new Date('2026-10-02T02:30:00.000Z');
  const flight = { ...arrival('a1', 'LA3043', 0), eta: new Date(now.getTime() + 50 * 60000).toISOString() };
  const calls = [];
  const provider = providerReturning({
    '2026-10-02': [],
    '2026-10-01': [record({ data: '2026-10-01', sta: '2026-10-02T02:50:00.000Z' })],
  }, calls);
  const [result] = await provider.getAssignments([flight]);
  assert.deepEqual(calls.map((call) => new URL(call.url).searchParams.get('data')), ['2026-10-01', '2026-10-02']);
  assert.equal(result.teamName, 'VICTOR - T4');
});

test('falha HTTP da Fonia vira erro tipado sem vazar a chave', async () => {
  const provider = new FoniaProvider({
    url: 'https://fonia.example/escalados',
    apiKey: 'segredo',
    fetchImpl: async () => ({ status: 401 }),
  });
  await assert.rejects(provider.getAssignments([arrival('a1', 'LA3043', 10)]), (error) =>
    error.code === 'FONIA_REJECTED' && !error.message.includes('segredo'));
});

test('env: FONIA_API_URL + INTEGRACAO_API_KEY_CHEGADA ligam a Fonia', () => {
  assert.equal(createProviders({}, silent).modes.fonia, 'nao-integrada');
  const providers = createProviders({
    FONIA_API_URL: 'https://fonia.example/integracao/chegadas/escalados',
    INTEGRACAO_API_KEY_CHEGADA: 'x',
  }, silent);
  assert.equal(providers.modes.fonia, 'api');
  assert.equal(providers.fonia.isConfigured(), true);
});

test('cores FONIA no painel: cinza, amarelo, vermelho, azul com equipe e verde na posição', async () => {
  const provider = providerReturning({
    '2026-10-01': [
      record({ voo: '1', equipe: { nome: 'ALFA - T1' } }),
      record({ voo: '2', equipe: { nome: 'BRAVO - T1' }, na_posicao: true }),
    ],
  });
  const providers = {
    malha: {
      getArrivals: async () => [
        arrival('escalado', 'LA1', 3),
        arrival('posicao', 'LA2', 4),
        arrival('critico', 'LA3', 4),
        arrival('atencao', 'LA4', 12),
        arrival('fora', 'LA5', 40),
      ],
    },
    fonia: provider,
  };
  const panel = await createPanelService(providers, silent).getPanelFlights(NOW);
  const colors = Object.fromEntries(panel.map((flight) => [
    flight.id,
    [PanelRules.foniaStatus(flight, NOW.getTime()), flight.fonia.teamName],
  ]));

  assert.deepEqual(colors, {
    escalado: ['blue', 'ALFA - T1'],
    posicao: ['green', 'BRAVO - T1'],
    critico: ['red', ''],
    atencao: ['yellow', ''],
    fora: ['gray', ''],
  });
  assert.ok(panel.every((flight) => flight.fonia.integrated === true));
});
