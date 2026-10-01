'use strict';

const SMART_FUEL_PATH = '/coi/attendances/summary/smart_fuel';

class WingletError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'WingletError';
    this.code = code;
  }
}

function validDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

class WingletClient {
  constructor({ baseUrl, apiKey, timeoutMs = 25000, fetchImpl = fetch } = {}) {
    this.baseUrl = String(baseUrl || '').trim().replace(/\/$/, '');
    this.apiKey = String(apiKey || '').trim();
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.apiKey);
  }

  async getSmartFuelSummary({ startDate, endDate } = {}) {
    if (!this.isConfigured()) {
      throw new WingletError('A consulta Smart Fuel não está configurada no servidor.', 'WINGLET_NOT_CONFIGURED');
    }
    if (!validDateKey(startDate) || !validDateKey(endDate)) {
      throw new WingletError('O período da consulta Smart Fuel é inválido.', 'WINGLET_INVALID_PERIOD');
    }

    const url = new URL(`${this.baseUrl}${SMART_FUEL_PATH}`);
    url.searchParams.set('start_date', startDate);
    url.searchParams.set('end_date', endDate);
    const signal = AbortSignal.timeout(this.timeoutMs);

    let response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { 'x-api-key': this.apiKey, Accept: 'application/json' },
        signal,
        redirect: 'error',
      });
    } catch (error) {
      if (signal.aborted) {
        throw new WingletError('A consulta Smart Fuel excedeu o tempo limite.', 'WINGLET_TIMEOUT');
      }
      throw new WingletError('Não foi possível consultar a API Smart Fuel.', 'WINGLET_UNAVAILABLE');
    }

    if (response.status !== 200) {
      throw new WingletError('A API Smart Fuel recusou a consulta.', 'WINGLET_REJECTED');
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new WingletError('A API Smart Fuel retornou uma resposta inválida.', 'WINGLET_INVALID_RESPONSE');
    }

    if (!payload || payload.success !== true || !Array.isArray(payload.data)) {
      throw new WingletError('A API Smart Fuel retornou uma resposta inválida.', 'WINGLET_INVALID_RESPONSE');
    }

    return payload.data;
  }
}

module.exports = { SMART_FUEL_PATH, WingletClient, WingletError };
