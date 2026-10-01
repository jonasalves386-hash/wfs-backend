'use strict';

const { buildServiceKey, selectEligibleArrivals } = require('../domain/panelRules');

// Por quanto tempo o último estado válido de um enriquecimento é reaproveitado
// após falhas consecutivas. Depois disso a linha volta para cinza (sem sinal),
// em vez de exibir dado antigo ou disparar vermelho por falta de informação.
const ENRICHMENT_MAX_AGE_MS = 10 * 60 * 1000;

function mapBy(items, key) {
  return new Map(items.map((item) => [item[key], item]));
}

function isIntegrated(provider) {
  if (!provider) return false;
  return typeof provider.isConfigured === 'function' ? provider.isConfigured() : true;
}

function createPanelService(providers, logger = console, { maxEnrichmentAgeMs = ENRICHMENT_MAX_AGE_MS } = {}) {
  const lastValid = {
    fonia: { items: [], at: 0 },
    rest: { items: [], at: 0 },
    smartFuel: { items: [], at: 0 },
  };

  /**
   * Executa um enriquecimento. Devolve { items, available }:
   * - provider não integrado: não é chamado e a linha fica cinza;
   * - falha: reaproveita o último estado válido enquanto for recente;
   * - falha prolongada (ou sem estado anterior): linha cinza.
   */
  async function enrichment(name, label, provider, task, nowMs) {
    if (!isIntegrated(provider)) return { items: [], available: false };
    const previous = lastValid[name];
    try {
      const items = await task();
      lastValid[name] = { items, at: nowMs };
      return { items, available: true };
    } catch (error) {
      logger.error(`[painel] Falha no provider ${label}; mantendo último estado válido.`, error.code || error.message);
      const fresh = previous.at > 0 && nowMs - previous.at <= maxEnrichmentAgeMs;
      return fresh ? { items: previous.items, available: true } : { items: [], available: false };
    }
  }

  async function getPanelFlights(now = new Date()) {
    const nowMs = now.getTime();
    let arrivals;
    try {
      arrivals = await providers.malha.getArrivals(now);
    } catch (error) {
      logger.error('[painel] Falha no provider SIGA/Malha.', error.code || error.name);
      throw error;
    }

    const normalizedArrivals = arrivals.map((flight) => ({
      ...flight,
      serviceKey: flight.serviceKey || buildServiceKey(flight.eta, flight.flightNumber.replace(/^\D+/, '')),
    }));
    const eligible = selectEligibleArrivals(normalizedArrivals, now);

    const [fonia, rest, smartFuel] = await Promise.all([
      enrichment('fonia', 'Fonia', providers.fonia, () => providers.fonia.getAssignments(eligible, now), nowMs),
      enrichment('rest', 'REST.', providers.rest, () => providers.rest.getStatuses(eligible, now), nowMs),
      enrichment('smartFuel', 'Smart Fuel', providers.smartFuel, () => providers.smartFuel.getStatuses(eligible, now), nowMs),
    ]);
    const foniaByOperation = mapBy(fonia.items, 'operationId');
    const restByKey = mapBy(rest.items, 'serviceKey');
    const smartFuelByOperation = mapBy(smartFuel.items, 'operationId');

    return eligible.map((flight) => {
      const assignment = foniaByOperation.get(flight.id);
      const restStatus = restByKey.get(flight.serviceKey);
      const smartFuelStatus = smartFuelByOperation.get(flight.id);
      return {
        ...flight,
        fonia: {
          integrated: fonia.available,
          teamName: assignment?.teamName || '',
          inPosition: Boolean(assignment?.inPosition),
        },
        rest: {
          integrated: rest.available,
          assigned: Boolean(restStatus?.assigned),
        },
        smartFuel: {
          integrated: smartFuel.available,
          assigned: Boolean(smartFuelStatus?.assigned),
          completed: Boolean(smartFuelStatus?.completed),
          teamName: smartFuelStatus?.teamName || '',
        },
      };
    });
  }

  function isMalhaStale() {
    return Boolean(providers.malha.isCacheStale?.());
  }

  return { getPanelFlights, isMalhaStale };
}

module.exports = { createPanelService, ENRICHMENT_MAX_AGE_MS };
