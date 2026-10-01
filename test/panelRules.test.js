'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  selectEligibleArrivals,
  foniaColor,
  restColor,
  buildServiceKey,
} = require('../src/domain/panelRules');
const { isWideBodyPrefix, normalizeAircraftPrefix } = require('../src/domain/wideBodyPrefixes');

const NOW = new Date('2026-09-29T15:00:00.000Z');
const flight = (id, minutes, extra = {}) => ({
  id,
  eta: new Date(NOW.getTime() + minutes * 60000).toISOString(),
  chocksOn: false,
  gateOpen: false,
  ...extra,
});

test('filtra 0..60 minutos, remove calço/porta aberta, ordena e limita em 12', () => {
  const input = [
    flight('past', -1),
    flight('future', 61),
    flight('chocked', 2, { chocksOn: true }),
    flight('door', 3, { gateOpen: true }),
    ...Array.from({ length: 14 }, (_, index) => flight(`ok-${index}`, 14 - index)),
  ];
  const selected = selectEligibleArrivals(input, NOW);
  assert.equal(selected.length, 12);
  assert.equal(selected[0].id, 'ok-13');
  assert.equal(selected.at(-1).id, 'ok-2');
});

test('exclui Wide dentro da janela e mantém Narrow elegível', () => {
  const selected = selectEligibleArrivals([
    flight('wide', 2, { aircraftPrefix: ' pr xta ' }),
    flight('narrow', 3, { aircraftPrefix: 'PR-MAG' }),
  ], NOW);
  assert.deepEqual(selected.map((item) => item.id), ['narrow']);
  assert.equal(normalizeAircraftPrefix(' pr xta '), 'PR-XTA');
  assert.equal(isWideBodyPrefix(' pr xta '), true);
  assert.equal(isWideBodyPrefix('PR-MAG'), false);
});

test('remove Wide antes do limite de 12 e preenche as 12 vagas com Narrow', () => {
  const arrivals = [
    ...Array.from({ length: 5 }, (_, index) => flight(`wide-${index}`, index + 1, { aircraftPrefix: 'PR-XTA' })),
    ...Array.from({ length: 12 }, (_, index) => flight(`narrow-${index}`, index + 1, { aircraftPrefix: 'PR-MAG' })),
  ];
  const selected = selectEligibleArrivals(arrivals, NOW);
  assert.equal(selected.length, 12);
  assert.ok(selected.every((item) => item.aircraftPrefix === 'PR-MAG'));
  assert.equal(selected[0].id, 'narrow-0');
});

test('aplica as prioridades de cor da Fonia', () => {
  assert.equal(foniaColor({ teamName: 'ALFA', inPosition: true }, 3), 'green');
  assert.equal(foniaColor({ teamName: 'ALFA', inPosition: false }, 3), 'blue');
  assert.equal(foniaColor(null, 3), 'red');
  assert.equal(foniaColor(null, 9), 'yellow');
  assert.equal(foniaColor(null, 16), 'gray');
});

test('aplica as cores da REST.', () => {
  assert.equal(restColor({ assigned: true }, 30), 'blue');
  assert.equal(restColor({ assigned: false }, 5), 'red');
  assert.equal(restColor({ assigned: false }, 15), 'yellow');
  assert.equal(restColor({ assigned: false }, 16), 'gray');
});

test('gera a chave operacional usada pela REST. no fuso de São Paulo', () => {
  assert.equal(buildServiceKey('2026-09-30T01:30:00.000Z', '00321'), '2026-09-29_321');
});
