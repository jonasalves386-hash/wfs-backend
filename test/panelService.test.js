'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPanelService } = require('../src/services/panelService');

const NOW = new Date('2026-09-29T15:00:00.000Z');

test('ETA inválido da Malha não é completado pela Fonia', async () => {
  const providers = {
    malha: {
      getArrivals: async () => [{
        id: 'arrival-without-eta',
        flightNumber: 'LA3001',
        origin: 'BSB',
        eta: null,
        paxDoorOpen: null,
        chocksOn: false,
        gateOpen: false,
      }],
    },
    fonia: {
      getAssignments: async () => [{
        operationId: 'arrival-without-eta',
        eta: '2026-09-29T15:30:00.000Z',
        teamName: 'ALFA',
        inPosition: true,
      }],
    },
    rest: { getStatuses: async () => [] },
  };

  const result = await createPanelService(providers).getPanelFlights(NOW);
  assert.deepEqual(result, []);
});

test('falha da Malha é propagada e não aciona fallback de voos', async () => {
  const failure = Object.assign(new Error('falha controlada'), { code: 'SIGA_UNAVAILABLE' });
  const providers = {
    malha: { getArrivals: async () => { throw failure; } },
    fonia: { getAssignments: async () => assert.fail('Fonia não deve executar') },
    rest: { getStatuses: async () => assert.fail('REST não deve executar') },
  };
  const silent = { error() {} };

  await assert.rejects(createPanelService(providers, silent).getPanelFlights(NOW), (error) => error === failure);
});
