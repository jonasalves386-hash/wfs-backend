'use strict';

const { buildServiceKey } = require('../domain/panelRules');

const TIMEZONE = 'America/Sao_Paulo';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validDateParts(value) {
  const match = text(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

function validTimeParts(value) {
  const match = text(value).match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  return match ? { hour: Number(match[1]), minute: Number(match[2]), second: Number(match[3] || 0) } : null;
}

function partsInTimezone(timestamp) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
}

function sigaDateTime(dateValue, timeValue) {
  const date = validDateParts(dateValue);
  const time = validTimeParts(timeValue);
  if (!date || !time) return null;

  const desiredWallTime = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, time.second);
  let instant = desiredWallTime;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const local = partsInTimezone(instant);
    const representedWallTime = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    instant += desiredWallTime - representedWallTime;
  }
  return new Date(instant).toISOString();
}

function hasOperationalTimestamp(value) {
  return text(value) !== '';
}

function normalizePaxDoorOpen(value) {
  const source = text(value);
  const match = source.match(/^(\d{2}\/\d{2}\/\d{4}) ([0-2]\d:[0-5]\d)(?::[0-5]\d)?$/);
  if (!match || !validDateParts(match[1]) || !validTimeParts(match[2])) return null;
  return match[2];
}

function sanitizeShape(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { type: typeof record };
  return Object.fromEntries(Object.keys(record).sort().map((key) => [
    key,
    record[key] === null ? 'null' : Array.isArray(record[key]) ? 'array' : typeof record[key],
  ]));
}

function adaptSigaArrival(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const id = text(record.id);
  const flightNumber = text(record.number_arrival);
  if (!id || !flightNumber) return null;

  const eta = sigaDateTime(record.eta_date, record.eta_time);
  const paxDoorOpen = normalizePaxDoorOpen(record.pax_door_open);
  return {
    id,
    aircraftPrefix: text(record.prefix) || null,
    serviceKey: buildServiceKey(eta, flightNumber.replace(/^\D+/, '')),
    flightNumber,
    origin: text(record.ori) || null,
    // O snapshot combina chegada e saída: `des` pertence à perna de saída seguinte.
    destination: null,
    eta,
    box: text(record.park_position_arrival) || null,
    paxDoorOpen,
    // Convenção já aprovada no adapter SIGA da Malha de Voos.
    chocksOn: hasOperationalTimestamp(record.engine_off) || hasOperationalTimestamp(record.arrival_time),
    gateOpen: hasOperationalTimestamp(record.pax_door_open),
    rawStatus: text(record.status_flight_arrival) || null,
  };
}

function adaptSigaArrivals(records) {
  const arrivals = [];
  let invalidRecords = 0;
  let arrivalsWithoutValidEta = 0;

  for (const record of records) {
    const arrival = adaptSigaArrival(record);
    if (!arrival) {
      invalidRecords += 1;
      continue;
    }
    if (!arrival.eta) arrivalsWithoutValidEta += 1;
    arrivals.push(arrival);
  }

  return { arrivals, diagnostics: { invalidRecords, arrivalsWithoutValidEta } };
}

module.exports = {
  TIMEZONE,
  text,
  validDateParts,
  validTimeParts,
  sigaDateTime,
  normalizePaxDoorOpen,
  sanitizeShape,
  adaptSigaArrival,
  adaptSigaArrivals,
};
