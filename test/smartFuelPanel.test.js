'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PanelRules = require('../../front-end/panelRules');
const { createPanelService } = require('../src/services/panelService');

const NOW = new Date('2026-09-30T15:00:00.000Z');

function arrival() {
  return {
    id: 'arrival-1',
    flightNumber: 'LA3043',
    origin: 'BSB',
    destination: 'GRU',
    aircraftPrefix: 'PR-MAG',
    eta: '2026-09-30T15:03:00.000Z',
    paxDoorOpen: null,
    chocksOn: false,
    gateOpen: false,
  };
}

test('cores Smart Fuel seguem pendente, escalado azul e concluído verde', () => {
  const eta = '2026-09-30T15:03:00.000Z';
  const base = { eta, smartFuel: { assigned: false, completed: false } };
  assert.equal(PanelRules.smartFuelStatus(base, NOW.getTime()), 'red');
  assert.equal(PanelRules.smartFuelStatus({ ...base, smartFuel: { assigned: true, completed: false } }, NOW.getTime()), 'blue');
  assert.equal(PanelRules.smartFuelStatus({ ...base, smartFuel: { assigned: true, completed: true } }, NOW.getTime()), 'green');
});

test('falha Smart Fuel preserva último estado válido e resposta vazia válida o limpa', async () => {
  let call = 0;
  const providers = {
    malha: { getArrivals: async () => [arrival()] },
    fonia: { getAssignments: async () => [] },
    rest: { getStatuses: async () => [] },
    smartFuel: {
      getStatuses: async () => {
        call += 1;
        if (call === 1) return [{ operationId: 'arrival-1', assigned: true, completed: false, teamName: 'JAIR - T3' }];
        if (call === 2) throw new Error('falha controlada');
        return [];
      },
    },
  };
  const service = createPanelService(providers, { error() {} });

  assert.equal((await service.getPanelFlights(NOW))[0].smartFuel.assigned, true);
  assert.equal((await service.getPanelFlights(NOW))[0].smartFuel.assigned, true);
  assert.deepEqual((await service.getPanelFlights(NOW))[0].smartFuel, {
    integrated: true,
    assigned: false,
    completed: false,
    teamName: '',
  });
});
