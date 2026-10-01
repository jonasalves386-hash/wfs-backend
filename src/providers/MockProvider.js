'use strict';

const { buildServiceKey } = require('../domain/panelRules');

function addMinutes(now, minutes) {
  return new Date(now.getTime() + minutes * 60000).toISOString();
}

class MockProvider {
  isConfigured() {
    return true;
  }

  async getArrivals(now = new Date()) {
    // Mantém os ETAs estáveis entre pollings para que TEMPO avance de verdade.
    this.baseTime ??= new Date(now);
    const reference = this.baseTime;
    const specs = [
      ['mock-arrival-critical', 'LA3001', 'CGH', 3, 'PR-MAG', '207', null, null],
      ['mock-arrival-warning', 'LA3002', 'BSB', 9, 'PR-MAK', '', null, null],
      ['mock-arrival-assigned', 'LA3003', 'SDU', 18, 'PR-MAL', '212', null, null],
      ['mock-arrival-position', 'LA3004', 'CNF', 25, 'PR-MAM', '301', null, null],
      ['mock-arrival-neutral', 'LA3005', 'POA', 35, 'PR-MAN', '302', null, null],
      ['mock-arrival-assigned-2', 'LA3006', 'REC', 48, 'PR-MAO', '', null, null],
      ['mock-hidden-wide', 'LA3996', 'GRU', 6, 'PR-XTA', '305', null, null],
      ['mock-hidden-chocked', 'LA3997', 'VCP', 7, 'PR-MAP', '306', null, addMinutes(reference, -1)],
      ['mock-hidden-door-open', 'LA3998', 'GIG', 12, 'PR-MAQ', '307', '15:07', null],
    ];

    return specs.map(([operationId, flightNumber, origin, minutes, aircraftPrefix, box, paxDoorOpen, onChock]) => {
      const eta = addMinutes(reference, minutes);
      return {
        id: operationId,
        aircraftPrefix,
        box,
        serviceKey: buildServiceKey(eta, flightNumber.replace(/^\D+/, '')),
        flightNumber,
        origin,
        eta,
        paxDoorOpen,
        chocksOn: Boolean(onChock),
        gateOpen: Boolean(paxDoorOpen),
        rawStatus: 'O',
      };
    });
  }

  async getAssignments(arrivals) {
    const scenarios = new Map([
      ['mock-arrival-assigned', { teamName: 'ALFA - T3', inPosition: false }],
      ['mock-arrival-position', { teamName: 'BRAVO - T3', inPosition: true }],
      ['mock-arrival-assigned-2', { teamName: 'DELTA - T3', inPosition: false }],
    ]);

    return arrivals.map((flight) => ({
      operationId: flight.id,
      leg: 'ARRIVAL',
      teamName: scenarios.get(flight.id)?.teamName || '',
      inPosition: scenarios.get(flight.id)?.inPosition || false,
      eta: null,
    }));
  }

  async getStatuses(arrivals) {
    const assigned = new Set(['mock-arrival-position', 'mock-arrival-assigned-2']);
    return arrivals.map((flight) => ({
      serviceKey: flight.serviceKey,
      assigned: assigned.has(flight.id),
    }));
  }
}

module.exports = { MockProvider, addMinutes };
