'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WingletClient, WingletError, SMART_FUEL_PATH } = require('../src/providers/WingletClient');
const {
  SmartFuelProvider,
  operatorLabel,
  queryPeriod,
} = require('../src/providers/SmartFuelProvider');

const NOW = new Date('2026-09-30T03:00:00.000Z');
const flight = (changes = {}) => ({
  id: 'siga-arrival-1',
  flightNumber: 'LA3043',
  origin: 'BSB',
  destination: 'GRU',
  aircraftPrefix: 'PR-MAG',
  eta: '2026-09-30T03:30:00.000Z',
  ...changes,
});
const record = (changes = {}) => ({
  record_id: 'winglet-1',
  flight_airline: ' la ',
  flight_number: '03043',
  flight_origin: 'bsb',
  flight_destination: 'gru',
  aircraft_registration: 'PRMAG',
  attendance_direction: ' Arrival ',
  assigned_at: '2026-09-29 23:15:00',
  record_status: 'assigned',
  attendance_status: 'assigned',
  step_2_status: 'pending',
  operator_1_name: 'Jair Ventura da Silva de Souza',
  operator_1_shift: ' t3 ',
  ...changes,
});

function providerWith(records, logger = { warn() {} }) {
  return new SmartFuelProvider({
    client: {
      isConfigured: () => true,
      getSmartFuelSummary: async () => records,
    },
    logger,
  });
}

test('client Winglet usa rota, período e x-api-key somente no backend', async () => {
  let request;
  const client = new WingletClient({
    baseUrl: 'https://winglet.example/api/',
    apiKey: 'segredo-de-teste#preservado',
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options };
      return { status: 200, json: async () => ({ success: true, data: [] }) };
    },
  });

  assert.deepEqual(await client.getSmartFuelSummary({ startDate: '2026-09-29', endDate: '2026-09-30' }), []);
  assert.equal(request.url.pathname, `/api${SMART_FUEL_PATH}`);
  assert.equal(request.url.searchParams.get('start_date'), '2026-09-29');
  assert.equal(request.url.searchParams.get('end_date'), '2026-09-30');
  assert.deepEqual(request.options.headers, {
    'x-api-key': 'segredo-de-teste#preservado',
    Accept: 'application/json',
  });
});

test('client diferencia resposta vazia válida de falhas HTTP e de contrato', async () => {
  const options = { baseUrl: 'https://winglet.example/api', apiKey: 'teste' };
  await assert.rejects(new WingletClient().getSmartFuelSummary({ startDate: '2026-09-29', endDate: '2026-09-30' }),
    (error) => error instanceof WingletError && error.code === 'WINGLET_NOT_CONFIGURED');
  await assert.rejects(new WingletClient({ ...options, fetchImpl: async () => ({ status: 401 }) })
    .getSmartFuelSummary({ startDate: '2026-09-29', endDate: '2026-09-30' }),
  (error) => error.code === 'WINGLET_REJECTED');
  await assert.rejects(new WingletClient({ ...options, fetchImpl: async () => ({
    status: 200,
    json: async () => ({ success: false, data: [] }),
  }) }).getSmartFuelSummary({ startDate: '2026-09-29', endDate: '2026-09-30' }),
  (error) => error.code === 'WINGLET_INVALID_RESPONSE');
});

test('consulta inclui a véspera para chegadas próximas à virada do dia', () => {
  assert.deepEqual(queryPeriod([flight()], NOW), {
    startDate: '2026-09-29',
    endDate: '2026-09-30',
  });
});

test('não reaproveita a operação homônima da véspera fora da janela da virada', async () => {
  const eveningFlight = flight({ eta: '2026-09-30T23:30:00.000Z' }); // 20:30 em São Paulo
  const previousDay = record({ assigned_at: '2026-09-29 20:15:00' });
  assert.deepEqual(await providerWith([previousDay]).getStatuses([eveningFlight], NOW), []);
});

test('voo sem registro correspondente permanece sem escalação', async () => {
  assert.deepEqual(await providerWith([]).getStatuses([flight()], NOW), []);
  assert.deepEqual(await providerWith([record({ flight_origin: 'CNF' })]).getStatuses([flight()], NOW), []);
});

test('registro ativo atribui azul e exibe somente primeiro nome e turno', async () => {
  assert.deepEqual(await providerWith([record()]).getStatuses([flight()], NOW), [{
    operationId: 'siga-arrival-1',
    assigned: true,
    completed: false,
    teamName: 'JAIR - T3',
  }]);
  assert.equal(operatorLabel('  Maria das Dores ', ' turno 2 '), 'MARIA - TURNO 2');
});

test('step 2 completed fica concluído; step 2 canceled continua escalado', async () => {
  const completed = await providerWith([record({
    record_status: 'completed',
    attendance_status: 'completed',
    step_2_status: ' COMPLETED ',
  })]).getStatuses([flight()], NOW);
  assert.equal(completed[0].completed, true);

  const canceledStep = await providerWith([record({ step_2_status: ' canceled ' })]).getStatuses([flight()], NOW);
  assert.equal(canceledStep[0].assigned, true);
  assert.equal(canceledStep[0].completed, false);
});

test('registro principal cancelado ou reatribuído não vira escalação ativa', async () => {
  const records = [
    record({ record_id: 'cancelado', record_status: 'canceled', attendance_status: 'canceled' }),
    record({ record_id: 'reatribuido', record_status: 'reassigned', attendance_status: 'reassigned' }),
  ];
  assert.deepEqual(await providerWith(records).getStatuses([flight()], NOW), []);
});

test('duplicidade seleciona o registro ativo mais recente', async () => {
  const older = record({ record_id: 'antigo', assigned_at: '2026-09-29 22:30:00', operator_1_name: 'Ana Lima' });
  const newer = record({ record_id: 'novo', assigned_at: '2026-09-29 23:30:00', operator_1_name: 'Bruno Lima' });
  const [status] = await providerWith([older, newer]).getStatuses([flight()], NOW);
  assert.equal(status.teamName, 'BRUNO - T3');
});

test('empate no registro mais recente é ambíguo e não associa', async () => {
  const warnings = [];
  const logger = { warn: (message) => warnings.push(message) };
  const records = [record({ record_id: 'a' }), record({ record_id: 'b' })];
  assert.deepEqual(await providerWith(records, logger).getStatuses([flight()], NOW), []);
  assert.equal(warnings.length, 1);
});

test('ausência de operador ou turno não bloqueia estado da escalação', async () => {
  const [status] = await providerWith([record({ operator_1_name: '', operator_1_shift: '' })])
    .getStatuses([flight()], NOW);
  assert.equal(status.assigned, true);
  assert.equal(status.completed, false);
  assert.equal(status.teamName, '');
});

test('não associa direção de saída nem data incompatível', async () => {
  const records = [
    record({ record_id: 'departure', attendance_direction: 'departure' }),
    record({ record_id: 'old', assigned_at: '2026-09-28 23:15:00' }),
  ];
  assert.deepEqual(await providerWith(records).getStatuses([flight()], NOW), []);
});

test('matrícula coincidente desempata candidatos, mas divergência isolada não bloqueia', async () => {
  const matching = record({ record_id: 'matching', aircraft_registration: 'PRMAG', operator_1_name: 'Celia Lima' });
  const different = record({ record_id: 'different', aircraft_registration: 'PRXYZ', operator_1_name: 'Dora Lima' });
  const [preferred] = await providerWith([different, matching]).getStatuses([flight()], NOW);
  assert.equal(preferred.teamName, 'CELIA - T3');

  const [onlyCandidate] = await providerWith([different]).getStatuses([flight()], NOW);
  assert.equal(onlyCandidate.teamName, 'DORA - T3');
});
