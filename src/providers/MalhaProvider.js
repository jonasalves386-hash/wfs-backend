'use strict';

const fs = require('fs');
const path = require('path');
const { adaptSigaArrivals, sanitizeShape } = require('./SigaArrivalAdapter');
const { SigaError } = require('./SigaClient');

class MalhaProvider {
  constructor({
    client,
    logger = console,
    staleAfterMs = 120000,
    minRefreshIntervalMs = 0,
    now = () => Date.now(),
    cachePath = '',
  } = {}) {
    this.client = client;
    this.logger = logger;
    this.staleAfterMs = staleAfterMs;
    this.minRefreshIntervalMs = minRefreshIntervalMs;
    this.lastAttemptAt = 0;
    this.now = now;
    this.cachePath = cachePath;
    this.loggedUnexpectedShape = false;
    this.cachedArrivals = null;
    this.cacheUpdatedAt = 0;
    this.refreshPromise = null;
    this.restoreCache();
  }

  isConfigured() {
    return Boolean(this.client?.isConfigured());
  }

  restoreCache() {
    if (!this.cachePath) return;
    try {
      const payload = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      if (!Array.isArray(payload?.arrivals) || !Number.isFinite(payload?.savedAt)) return;
      this.cachedArrivals = payload.arrivals;
      this.cacheUpdatedAt = payload.savedAt;
    } catch (error) {
      if (error.code !== 'ENOENT') this.logger.warn('[SIGA] Cache local inválido; aguardando novo snapshot.');
    }
  }

  persistCache() {
    if (!this.cachePath) return;
    try {
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      // Grava em arquivo temporário e renomeia para nunca deixar JSON parcial.
      const temporaryPath = `${this.cachePath}.tmp`;
      fs.writeFileSync(temporaryPath, JSON.stringify({
        savedAt: this.cacheUpdatedAt,
        arrivals: this.cachedArrivals,
      }));
      fs.renameSync(temporaryPath, this.cachePath);
    } catch {
      this.logger.warn('[SIGA] Não foi possível persistir o cache local do snapshot.');
    }
  }

  async loadArrivals() {
    const snapshot = await this.client.getFlightsSnapshot();
    const result = adaptSigaArrivals(snapshot);

    if (snapshot.length > 0 && result.arrivals.length === 0) {
      if (!this.loggedUnexpectedShape) {
        this.loggedUnexpectedShape = true;
        this.logger.warn('[SIGA] Estrutura sem chegadas reconhecíveis (amostra sanitizada):', sanitizeShape(snapshot[0]));
      }
      // Snapshot incompatível não pode substituir um cache saudável por zero voos.
      throw new SigaError(502, 'A API SIGA retornou uma resposta inválida.', 'SIGA_INVALID_RESPONSE');
    }

    if (result.diagnostics.arrivalsWithoutValidEta > 0) {
      this.logger.warn(`[SIGA] ${result.diagnostics.arrivalsWithoutValidEta} chegada(s) sem ETA válido foram ignoradas.`);
    }
    this.cachedArrivals = result.arrivals;
    this.cacheUpdatedAt = this.now();
    this.persistCache();
    return this.cachedArrivals;
  }

  refresh() {
    if (!this.refreshPromise) {
      this.lastAttemptAt = this.now();
      this.refreshPromise = this.loadArrivals().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  async getArrivals() {
    if (!this.cachedArrivals) return this.refresh();
    if (this.now() - this.lastAttemptAt < this.minRefreshIntervalMs) return this.cachedArrivals;

    void this.refresh().catch((error) => {
      this.logger.error('[SIGA] Atualização falhou; mantendo último snapshot válido.', error.code || error.name);
    });
    return this.cachedArrivals;
  }

  isCacheStale() {
    return Boolean(this.cachedArrivals) && this.now() - this.cacheUpdatedAt > this.staleAfterMs;
  }
}

module.exports = { MalhaProvider };
