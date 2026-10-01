'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MockProvider } = require('../src/providers/MockProvider');
const { createPanelService } = require('../src/services/panelService');
const { foniaColor, minutesUntil, restColor } = require('../src/domain/panelRules');

test('mock cobre todos os cenários visuais e oculta calço/porta aberta', async () => {
  const now = new Date('2026-09-29T15:00:00.000Z');
  const mock = new MockProvider();
  const service = createPanelService({ malha: mock, fonia: mock, rest: mock });
  const panel = await service.getPanelFlights(now);

  assert.equal(panel.length, 6);
  assert.ok(!panel.some((flight) => flight.id === 'mock-hidden-wide'));
  assert.ok(panel.some((flight) => flight.box === '207'));
  assert.ok(panel.every((flight) => flight.paxDoorOpen === null));
  assert.ok(!panel.some((flight) => flight.id.startsWith('mock-hidden')));

  const foniaColors = new Set(panel.map((item) => foniaColor(item.fonia, minutesUntil(item.eta, now))));
  assert.deepEqual(foniaColors, new Set(['red', 'yellow', 'blue', 'green', 'gray']));

  const restColors = new Set(panel.map((item) => restColor(item.rest, minutesUntil(item.eta, now))));
  assert.deepEqual(restColors, new Set(['red', 'yellow', 'gray', 'blue']));
});
