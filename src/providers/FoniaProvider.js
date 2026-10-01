'use strict';

const { saoPauloDateKey } = require('../domain/panelRules');

// Fallback para quando a `data` da Fonia não coincide com a data do ETA da
// Malha (ex.: voo previsto para 23:50 que atrasou para 00:20).
const CROSS_DAY_TOLERANCE_MS = 6 * 60 * 60 * 1000;
// ETA de madrugada também consulta a véspera para achar esses voos.
const EARLY_MORNING_HOUR = 6;

class FoniaError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'FoniaError';
    this.code = code;
  }
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function normalizeCode(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// "LA3043" (Malha) e "3043"/"03043" (Fonia) viram "3043"; sufixo de letra é mantido.
function normalizeFlightNumber(value) {
  const source = normalizeCode(value);
  const match = source.match(/^(?:[A-Z][A-Z0-9]|[0-9][A-Z])?(\d+)([A-Z]?)$/);
  if (!match) return source;
  return `${match[1].replace(/^0+(?=\d)/, '')}${match[2]}`;
}

function timestamp(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Registro da API de escalados da Fonia (WFS-FONIA /integracao/chegadas/escalados).
 * O casamento com a Malha é data + voo da perna de CHEGADA.
 */
function adaptFoniaRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const date = text(record.data);
  const flightNumber = normalizeFlightNumber(record.voo);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !flightNumber || record.cancelado === true) return null;

  const teamName = text(record.equipe?.nome);
  const escalado = record.escalado === true || Boolean(teamName);
  return {
    date,
    flightNumber,
    prefix: normalizeCode(record.prefixo),
    sta: timestamp(record.sta),
    escalado,
    teamName: escalado ? teamName || 'ESCALADO' : '',
    // Botão "na posição" apertado; iniciada/finalizada implicam que a equipe já chegou.
    inPosition: escalado && (record.na_posicao === true || record.iniciada === true || record.finalizada === true),
  };
}

function previousDateKey(dateKey) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function saoPauloHour(value) {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23',
  }).format(new Date(value));
  return Number(hour);
}

function queryDates(arrivals) {
  const dates = new Set();
  for (const flight of arrivals) {
    const date = saoPauloDateKey(flight.eta);
    if (!date) continue;
    dates.add(date);
    if (saoPauloHour(flight.eta) < EARLY_MORNING_HOUR) dates.add(previousDateKey(date));
  }
  return [...dates].sort();
}

function findRecord(records, flight) {
  const number = normalizeFlightNumber(flight.flightNumber);
  const date = saoPauloDateKey(flight.eta);
  const etaMs = timestamp(flight.eta);
  if (!number || !date) return null;

  const sameFlight = records.filter((record) => record.flightNumber === number);
  let candidates = sameFlight.filter((record) => record.date === date);
  if (!candidates.length && etaMs !== null) {
    candidates = sameFlight.filter((record) => record.sta !== null && Math.abs(record.sta - etaMs) <= CROSS_DAY_TOLERANCE_MS);
  }
  if (candidates.length > 1) {
    const prefix = normalizeCode(flight.aircraftPrefix);
    const samePrefix = candidates.filter((record) => prefix && record.prefix === prefix);
    if (samePrefix.length) candidates = samePrefix;
  }
  // Mais de um registro restante: prioriza o que tem equipe escalada.
  return candidates.find((record) => record.escalado) || candidates[0] || null;
}

class FoniaProvider {
  constructor({ url, apiKey, timeoutMs = 25000, fetchImpl = fetch } = {}) {
    this.url = text(url).replace(/\/+$/, '');
    this.apiKey = text(apiKey);
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  isConfigured() {
    return /^https?:\/\//.test(this.url) && Boolean(this.apiKey);
  }

  async getEscalados(date) {
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
      if (signal.aborted) throw new FoniaError('A consulta da Fonia excedeu o tempo limite.', 'FONIA_TIMEOUT');
      throw new FoniaError('Não foi possível consultar a API da Fonia.', 'FONIA_UNAVAILABLE');
    }
    if (response.status !== 200) {
      throw new FoniaError('A API da Fonia recusou a consulta.', 'FONIA_REJECTED');
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new FoniaError('A API da Fonia retornou uma resposta inválida.', 'FONIA_INVALID_RESPONSE');
    }
    if (!Array.isArray(payload)) {
      throw new FoniaError('A API da Fonia retornou uma resposta inválida.', 'FONIA_INVALID_RESPONSE');
    }
    return payload.map(adaptFoniaRecord).filter(Boolean);
  }

  async getAssignments(arrivals) {
    if (!this.isConfigured()) throw new FoniaError('A API da Fonia não está configurada.', 'FONIA_NOT_CONFIGURED');
    const dates = queryDates(arrivals);
    if (!dates.length) return [];

    const records = (await Promise.all(dates.map((date) => this.getEscalados(date)))).flat();
    return arrivals.map((flight) => {
      const record = findRecord(records, flight);
      return {
        operationId: flight.id,
        leg: 'ARRIVAL',
        teamName: record?.teamName || '',
        inPosition: Boolean(record?.inPosition),
      };
    });
  }
}

module.exports = { FoniaProvider, FoniaError, adaptFoniaRecord, findRecord, normalizeFlightNumber, queryDates };
