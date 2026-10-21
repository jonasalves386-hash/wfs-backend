'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PanelRules = require('../../front-end/panelRules');
const { adaptFoniaRecord } = require('../src/providers/FoniaProvider');
const { createPanelService } = require('../src/services/panelService');
const { equipmentColor } = require('../src/domain/panelRules');

const NOW = new Date('2026-10-20T15:00:00.000Z');
const silent = { warn() {}, error() {}, log() {} };

const base = (checklist, changes = {}) => ({
  voo: '3043', data: '2026-10-20', escalado: true, equipe: { nome: 'ALFA - T1' },
  na_posicao: true, cancelado: false, checklist, ...changes,
});

test('adapter: escada obrigatória pela regra; conveyor sempre, prancha substitui', () => {
  const pending = adaptFoniaRecord(base(null)).equipment;
  assert.deepEqual(pending.stairs, { required: null, confirmed: false });
  assert.deepEqual(pending.conveyor, { required: true, confirmed: false, label: '' });

  const ok = adaptFoniaRecord(base({ escada: true, escada_necessaria: true, conveyor: true, conveyor_numero: 'CV045', prancha: null })).equipment;
  assert.deepEqual(ok.stairs, { required: true, confirmed: true });
  assert.deepEqual(ok.conveyor, { required: true, confirmed: true, label: 'CV045' });

  const plank = adaptFoniaRecord(base({ escada: null, escada_necessaria: false, conveyor: false, prancha: true })).equipment;
  assert.equal(plank.stairs.required, false);
  assert.deepEqual(plank.conveyor, { required: true, confirmed: true, label: 'PRANCHA' });

  const semConveyor = adaptFoniaRecord(base({ escada: false, escada_necessaria: true, conveyor: false, prancha: null })).equipment;
  assert.equal(semConveyor.stairs.confirmed, false);
  assert.equal(semConveyor.conveyor.confirmed, false);
});

test('cores: verde confirmado; pendente cinza > 10, amarelo <= 10, vermelho <= 5; não obrigatório cinza', () => {
  const pending = { required: true, confirmed: false };
  assert.equal(equipmentColor(pending, 11), 'gray');
  assert.equal(equipmentColor(pending, 10), 'yellow');
  assert.equal(equipmentColor(pending, 5), 'red');
  assert.equal(equipmentColor(pending, -20), 'red');
  assert.equal(equipmentColor({ required: true, confirmed: true }, 2), 'green');
  assert.equal(equipmentColor({ required: false, confirmed: false }, 2), 'gray');
  assert.equal(equipmentColor({ required: null, confirmed: false }, 2), 'gray');

  const nowMs = NOW.getTime();
  const flight = { eta: new Date(nowMs + 4 * 60000).toISOString() };
  assert.equal(PanelRules.equipmentStatus({ integrated: true, ...pending }, flight, nowMs), 'red');
  assert.equal(PanelRules.equipmentStatus({ integrated: false, ...pending }, flight, nowMs), 'gray');
});

function service(equipmentFor, holdEquipment = true) {
  const arrival = (id, minutes) => ({
    id, flightNumber: `LA${id.length}`, aircraftPrefix: 'PR-MAG', chocksOn: false, gateOpen: false, rawStatus: 'O',
    eta: new Date(NOW.getTime() + minutes * 60000).toISOString(),
  });
  return createPanelService({
    malha: { getArrivals: async () => [arrival('passou', -15), arrival('antigo', -31), arrival('futuro', 20)] },
    fonia: {
      isConfigured: () => true,
      getAssignments: async (flights) => flights.map((flight) => ({
        operationId: flight.id, teamName: 'ALFA - T1', inPosition: true, equipment: equipmentFor(flight),
      })),
    },
  }, silent, { holdEquipment });
}

test('escada ou conveyor obrigatório sem confirmação trava o voo; confirmado libera', async () => {
  const pendingConveyor = await service(() => ({
    stairs: { required: false, confirmed: false },
    conveyor: { required: true, confirmed: false, label: '' },
  })).getPanelFlights(NOW);
  assert.deepEqual(pendingConveyor.map((flight) => [flight.id, flight.held]), [['passou', true], ['futuro', false]]);

  const pendingStairs = await service(() => ({
    stairs: { required: true, confirmed: false },
    conveyor: { required: true, confirmed: true, label: 'CV045' },
  })).getPanelFlights(NOW);
  assert.equal(pendingStairs[0].held, true);

  const allOk = await service(() => ({
    stairs: { required: true, confirmed: true },
    conveyor: { required: true, confirmed: true, label: 'PRANCHA' },
  })).getPanelFlights(NOW);
  assert.deepEqual(allOk.map((flight) => flight.id), ['futuro']);
  assert.deepEqual(allOk[0].conveyor, { integrated: true, required: true, confirmed: true, label: 'PRANCHA' });
});

test('escada com regra desconhecida (null) não trava nem alarma', async () => {
  const panel = await service(() => ({
    stairs: { required: null, confirmed: false },
    conveyor: { required: true, confirmed: true, label: 'CV001' },
  })).getPanelFlights(NOW);
  assert.deepEqual(panel.map((flight) => flight.id), ['futuro']);
});

test('trava de escada/conveyor vale só até 30 min após o ETA', async () => {
  const panel = await service(() => ({
    stairs: { required: true, confirmed: false },
    conveyor: { required: true, confirmed: false, label: '' },
  })).getPanelFlights(NOW);
  // 'passou' (-15) fica travado; 'antigo' (-31) já saiu.
  assert.deepEqual(panel.map((flight) => flight.id), ['passou', 'futuro']);
});

test('regra da escada pela posição e origem', () => {
  const { stairsRequiredFor } = require('../src/domain/stairsRule');
  const at = (box, origin = 'BSB') => stairsRequiredFor({ box, origin });
  assert.equal(at('114'), true);   // Ilha
  assert.equal(at('203L'), true);  // Pátio 100
  assert.equal(at('207'), false);  // T2 Oeste
  assert.equal(at('306R'), false);
  assert.equal(at('406'), false);  // T2 Leste
  assert.equal(at('411R'), true);  // MOP
  assert.equal(at('507', 'BSB'), true);  // T3 nacional
  assert.equal(at('550', 'EZE'), null);  // T3 internacional: depende da saída
  assert.equal(at('620'), true);   // Pátios 6/7
  assert.equal(at('715'), true);
  assert.equal(at('716'), null);
  assert.equal(at('101'), null);
  assert.equal(at(''), null);
});

test('sem checklist a escada usa a regra; com escada_necessaria da Fonia vale a Fonia', async () => {
  const { FoniaProvider } = require('../src/providers/FoniaProvider');
  const records = [
    { voo: '1', data: '2026-10-20', escalado: true, equipe: { nome: 'A' }, na_posicao: true, checklist: null },
    { voo: '2', data: '2026-10-20', escalado: true, equipe: { nome: 'B' }, na_posicao: true,
      checklist: { escada: null, escada_necessaria: false, conveyor: null, prancha: null } },
  ];
  const provider = new FoniaProvider({
    url: 'https://fonia.example/x', apiKey: 'k',
    fetchImpl: async () => ({ status: 200, json: async () => records }),
  });
  const eta = new Date(NOW.getTime() + 10 * 60000).toISOString();
  const [rule, fonia] = await provider.getAssignments([
    { id: 'a', flightNumber: 'LA1', eta, box: '411R', origin: 'BSB' },
    { id: 'b', flightNumber: 'LA2', eta, box: '411R', origin: 'BSB' },
  ]);
  assert.equal(rule.equipment.stairs.required, true);
  assert.equal(fonia.equipment.stairs.required, false);
});

test('trava de escada/conveyor desligada (padrão): alerta, mas não segura o voo', async () => {
  const panel = await service(() => ({
    stairs: { required: true, confirmed: false },
    conveyor: { required: true, confirmed: false, label: '' },
  }), false).getPanelFlights(NOW);
  assert.deepEqual(panel.map((flight) => flight.id), ['futuro']);
  assert.equal(panel[0].conveyor.required, true);
});
