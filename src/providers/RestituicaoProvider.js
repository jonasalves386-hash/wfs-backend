'use strict';

const { saoPauloDateKey } = require('../domain/panelRules');
const { normalizeFlightNumber, queryDates } = require('./FoniaProvider');

class RestituicaoError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'RestituicaoError';
    this.code = code;
  }
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

// Voo que atrasou depois da meia-noite: casa pela proximidade do STA.
const CROSS_DAY_TOLERANCE_MS = 6 * 60 * 60 * 1000;

function normalizeCode(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function timestamp(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function previousDateKey(dateKey) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Registro da fila do WFS-RESTITUIÇÃO (/integracao/chegadas). Voo cancelado
 * não vem na resposta. O casamento com a Malha é data + voo da chegada.
 */
function adaptRestituicaoRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const date = text(record.data);
  const flightNumber = normalizeFlightNumber(record.voo);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !flightNumber) return null;

  // Só o operador do trator: `equipe` é a equipe da Fonia e não deve aparecer na REST.
  const operatorName = text(record.operador);
  const assigned = record.escalado === true;
  return {
    date,
    flightNumber,
    prefix: normalizeCode(record.prefixo),
    sta: timestamp(record.sta),
    assigned,
    operatorName: assigned ? operatorName || 'ESCALADO' : '',
  };
}

function findRecord(records, flight) {
  const number = normalizeFlightNumber(flight.flightNumber);
  const date = saoPauloDateKey(flight.eta);
  if (!number || !date) return null;
  const etaMs = timestamp(flight.eta);
  const sameFlight = records.filter((record) => record.flightNumber === number);
  let pool = sameFlight.filter((record) => record.date === date);
  // Voo previsto 23:50 que atrasou para 00:20 continua na fila do dia anterior:
  // casa pelo STA próximo do ETA; sem STA, pela data da véspera.
  if (!pool.length && etaMs !== null) {
    pool = sameFlight.filter((record) => record.sta !== null && Math.abs(record.sta - etaMs) <= CROSS_DAY_TOLERANCE_MS);
  }
  if (!pool.length) pool = sameFlight.filter((record) => record.date === previousDateKey(date) && record.sta === null);
  if (pool.length > 1) {
    // Desempate: mesma aeronave; depois o STA mais próximo do ETA.
    const prefix = normalizeCode(flight.aircraftPrefix);
    const samePrefix = pool.filter((record) => prefix && record.prefix === prefix);
    if (samePrefix.length) pool = samePrefix;
    if (etaMs !== null) {
      pool = [...pool].sort((a, b) => (a.sta === null ? Infinity : Math.abs(a.sta - etaMs))
        - (b.sta === null ? Infinity : Math.abs(b.sta - etaMs)));
    }
  }
  return pool[0] || null;
}

class RestituicaoProvider {
  constructor({ url, apiKey, timeoutMs = 25000, fetchImpl = fetch } = {}) {
    this.url = text(url).replace(/\/+$/, '');
    this.apiKey = text(apiKey);
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  isConfigured() {
    return /^https?:\/\//.test(this.url) && Boolean(this.apiKey);
  }

  async getFila(date) {
    const url = new URL(this.url);
    url.searchParams.set('data', date);
    const signal = AbortSignal.timeout(this.timeoutMs);

    let response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { 'x-api-key': this.apiKey, Accept: 'application/json' },
        signal,
      });
    } catch {
      if (signal.aborted) throw new RestituicaoError('A consulta da Restituição excedeu o tempo limite.', 'RESTITUICAO_TIMEOUT');
      throw new RestituicaoError('Não foi possível consultar a API da Restituição.', 'RESTITUICAO_UNAVAILABLE');
    }
    if (response.status !== 200) {
      throw new RestituicaoError('A API da Restituição recusou a consulta.', 'RESTITUICAO_REJECTED');
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new RestituicaoError('A API da Restituição retornou uma resposta inválida.', 'RESTITUICAO_INVALID_RESPONSE');
    }
    if (!Array.isArray(payload)) {
      throw new RestituicaoError('A API da Restituição retornou uma resposta inválida.', 'RESTITUICAO_INVALID_RESPONSE');
    }
    return payload.map(adaptRestituicaoRecord).filter(Boolean);
  }

  async getStatuses(arrivals) {
    if (!this.isConfigured()) {
      throw new RestituicaoError('A API da Restituição não está configurada.', 'RESTITUICAO_NOT_CONFIGURED');
    }
    const dates = queryDates(arrivals);
    if (!dates.length) return [];

    const records = (await Promise.all(dates.map((date) => this.getFila(date)))).flat();
    return arrivals.map((flight) => {
      const record = findRecord(records, flight);
      return {
        serviceKey: flight.serviceKey,
        found: Boolean(record),
        assigned: Boolean(record?.assigned),
        operatorName: record?.operatorName || '',
      };
    });
  }
}

module.exports = { RestituicaoProvider, RestituicaoError, adaptRestituicaoRecord, findRecord };
