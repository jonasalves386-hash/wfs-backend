'use strict';

const { requestJson, bearerHeaders } = require('./httpClient');

class RestProvider {
  constructor({ baseUrl, token, timeoutMs = 10000 } = {}) {
    this.baseUrl = String(baseUrl || '').trim().replace(/\/$/, '');
    this.token = String(token || '').trim();
    this.timeoutMs = timeoutMs;
  }

  isConfigured() {
    return Boolean(this.baseUrl);
  }

  async getStatuses(arrivals) {
    if (!this.isConfigured()) throw new Error('REST_API_BASE_URL não configurada');
    const wantedKeys = new Set(arrivals.map((flight) => flight.serviceKey).filter(Boolean));
    if (!wantedKeys.size) return [];

    const flights = await requestJson(`${this.baseUrl}/voos?tipo=chegada`, {
      headers: bearerHeaders(this.token),
      timeoutMs: this.timeoutMs,
    });
    if (!Array.isArray(flights)) throw new Error('Contrato inválido da REST.: esperado array de voos');

    const matchingIds = flights
      .map((flight) => String(flight.id || '').trim())
      .filter((id) => wantedKeys.has(id));
    if (!matchingIds.length) return [];

    const tripsByFlight = await requestJson(`${this.baseUrl}/viagens/buscar`, {
      method: 'POST',
      headers: bearerHeaders(this.token, true),
      body: { vooIds: matchingIds },
      timeoutMs: this.timeoutMs,
    });

    return matchingIds.map((serviceKey) => ({
      serviceKey,
      assigned: Array.isArray(tripsByFlight?.[serviceKey]) && tripsByFlight[serviceKey].length > 0,
    }));
  }
}

module.exports = { RestProvider };
