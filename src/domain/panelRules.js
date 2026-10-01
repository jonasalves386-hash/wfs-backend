'use strict';

const TIMEZONE = 'America/Sao_Paulo';
const WINDOW_MINUTES = 60;
const MAX_FLIGHTS = 12;
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

function selectEligibleArrivals(arrivals, now = new Date()) {
  return filterNarrowBody(arrivals)
    .filter((flight) => {
      if (isCancelled(flight)) return false;
      const remaining = minutesUntil(flight.eta, now);
      return remaining !== null
        && remaining >= 0
        && remaining <= WINDOW_MINUTES
        && !flight.chocksOn
        && !flight.gateOpen;
    })
    .sort((a, b) => timestamp(a.eta) - timestamp(b.eta))
    .slice(0, MAX_FLIGHTS);
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
  CANCELLED_STATUSES,
  timestamp,
  isCancelled,
  minutesUntil,
  selectEligibleArrivals,
  pendingColor,
  foniaColor,
  restColor,
  saoPauloDateKey,
  normalizeServiceFlightNumber,
  buildServiceKey,
};
