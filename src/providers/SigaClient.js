'use strict';

class SigaError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'SigaError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Cliente aprovado no WFS-RETIRADAS: snapshot SIGA autenticado por x-api-key.
 * A URL e a chave existem apenas no backend e nunca são incluídas em erros.
 */
class SigaClient {
  constructor({ baseUrl, apiKey, timeoutMs = 120000, fetchImpl = fetch } = {}) {
    this.baseUrl = String(baseUrl || '').trim().replace(/\/$/, '');
    this.apiKey = String(apiKey || '').trim();
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.apiKey);
  }

  async getFlightsSnapshot() {
    if (!this.isConfigured()) {
      throw new SigaError(503, 'A consulta de voos SIGA não está configurada no servidor.', 'SIGA_NOT_CONFIGURED');
    }

    const signal = AbortSignal.timeout(this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/siga-flights/public`, {
        method: 'GET',
        headers: { 'x-api-key': this.apiKey, Accept: 'application/json' },
        signal,
        redirect: 'error',
      });
    } catch (error) {
      if (signal.aborted) {
        throw new SigaError(504, 'A consulta de voos SIGA excedeu o tempo limite.', 'SIGA_TIMEOUT');
      }
      throw new SigaError(502, 'Não foi possível obter os voos SIGA.', 'SIGA_UNAVAILABLE');
    }

    if (response.status !== 200) {
      throw new SigaError(502, 'A API SIGA recusou a consulta de voos.', 'SIGA_REJECTED');
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      if (signal.aborted) {
        throw new SigaError(504, 'A consulta de voos SIGA excedeu o tempo limite.', 'SIGA_TIMEOUT');
      }
      throw new SigaError(502, 'A API SIGA retornou uma resposta inválida.', 'SIGA_INVALID_RESPONSE');
    }
    if (!Array.isArray(payload)) {
      throw new SigaError(502, 'A API SIGA retornou uma resposta inválida.', 'SIGA_INVALID_RESPONSE');
    }
    return payload;
  }
}

module.exports = { SigaClient, SigaError };
