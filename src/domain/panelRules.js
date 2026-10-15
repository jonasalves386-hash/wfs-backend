'use strict';

const TIMEZONE = 'America/Sao_Paulo';
const WINDOW_MINUTES = 60;
const MAX_FLIGHTS = 12;
// Voo travado (sem "na posição" na Fonia) fica no painel por no máximo este
// tempo após o ETA, para um registro esquecido não ocupar a tela para sempre.
const HOLD_MAX_MINUTES = 180;
// Status SIGA da perna de chegada que indicam voo cancelado.
const CANCELLED_STATUSES = new Set(['C']);
const { filterNarrowBody } = require('./wideBodyPrefixes');

function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function minutesUntil(eta, now = new Date()) {
  const etaMs = timestamp(eta);
  if (etaMs === null) return null;
  return (etaMs - now.getTime()) / 60000;
}

function isCancelled(flight) {
  return CANCELLED_STATUSES.has(String(flight.rawStatus || '').trim().toUpperCase());
}

// Voos que podem aparecer no painel: os da janela normal e os que já passaram
// (ETA vencido, calço ou porta aberta) e ainda podem estar travados pela Fonia.
function selectPanelCandidates(arrivals, now = new Date()) {
  return filterNarrowBody(arrivals).filter((flight) => {
    if (isCancelled(flight)) return false;
    const remaining = minutesUntil(flight.eta, now);
    return remaining !== null && remaining <= WINDOW_MINUTES && remaining >= -HOLD_MAX_MINUTES;
  });
}

function isInLiveWindow(flight, now = new Date()) {
  const remaining = minutesUntil(flight.eta, now);
  return remaining !== null
    && remaining >= 0
    && remaining <= WINDOW_MINUTES
    && !flight.chocksOn
    && !flight.gateOpen;
}

/**
 * Seleciona os voos do painel. `shouldHold(flight)` mantém um voo que já
 * sairia (ETA vencido, calço, porta) — usado para travar até a Fonia
 * registrar "na posição". Ordena por ETA e limita em 12.
 */
function selectPanelArrivals(candidates, now = new Date(), shouldHold = () => false) {
  return candidates
    .map((flight) => {
      if (isInLiveWindow(flight, now)) return { ...flight, held: false };
      return shouldHold(flight) ? { ...flight, held: true } : null;
    })
    .filter(Boolean)
    .sort((a, b) => timestamp(a.eta) - timestamp(b.eta))
    .slice(0, MAX_FLIGHTS);
}

function selectEligibleArrivals(arrivals, now = new Date()) {
  return selectPanelArrivals(selectPanelCandidates(arrivals, now), now)
    .map(({ held, ...flight }) => flight);
}

function pendingColor(minutes) {
  if (minutes <= 5) return 'red';
  if (minutes <= 15) return 'yellow';
  return 'gray';
}

function foniaColor(assignment, minutes) {
  if (assignment?.teamName && assignment.inPosition) return 'green';
  if (assignment?.teamName) return 'blue';
  return pendingColor(minutes);
}

function restColor(status, minutes) {
  return status?.assigned ? 'blue' : pendingColor(minutes);
}

function saoPauloDateKey(value) {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeServiceFlightNumber(value) {
  return String(value || '').trim().replace(/^0+(?=\d)/, '');
}

function buildServiceKey(eta, flightNumber) {
  const date = saoPauloDateKey(eta);
  const number = normalizeServiceFlightNumber(flightNumber);
  return date && number ? `${date}_${number}` : '';
}

module.exports = {
  TIMEZONE,
  WINDOW_MINUTES,
  MAX_FLIGHTS,
  HOLD_MAX_MINUTES,
  CANCELLED_STATUSES,
  timestamp,
  isCancelled,
  minutesUntil,
  selectEligibleArrivals,
  selectPanelCandidates,
  selectPanelArrivals,
  isInLiveWindow,
  pendingColor,
  foniaColor,
  restColor,
  saoPauloDateKey,
  normalizeServiceFlightNumber,
  buildServiceKey,
};
