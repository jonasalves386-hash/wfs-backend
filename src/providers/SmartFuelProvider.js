'use strict';

const { saoPauloDateKey } = require('../domain/panelRules');

const INACTIVE_STATUSES = new Set(['canceled', 'cancelled', 'reassigned']);
const ACTIVE_STATUSES = new Set(['assigned', 'in_progress', 'completed']);
const ROLLOVER_LOOKBACK_HOURS = 6;

function cleanText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeCode(value) {
  return cleanText(value).toLocaleUpperCase('en-US').replace(/[^A-Z0-9]/g, '');
}

function normalizeStatus(value) {
  return cleanText(value).toLocaleLowerCase('en-US').replace(/[\s-]+/g, '_');
}

function normalizeFlightNumber(value) {
  const source = normalizeCode(value);
  const match = source.match(/^(\d+)([A-Z]?)$/);
  if (!match) return source;
  return `${match[1].replace(/^0+(?=\d)/, '')}${match[2]}`;
}

function arrivalFlightIdentity(value) {
  const source = normalizeCode(value);
  const match = source.match(/^([A-Z0-9]{2})(\d+[A-Z]?)$/);
  if (!match) return null;
  return { airline: match[1], number: normalizeFlightNumber(match[2]) };
}

function wingletAssignedAt(value) {
  const source = cleanText(value);
  const match = source.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    check.getUTCFullYear() !== year
    || check.getUTCMonth() !== month - 1
    || check.getUTCDate() !== day
    || check.getUTCHours() !== hour
    || check.getUTCMinutes() !== minute
    || check.getUTCSeconds() !== second
  ) return null;

  const dateKey = `${match[1]}-${match[2]}-${match[3]}`;
  return { dateKey, sortKey: `${dateKey}T${match[4]}:${match[5]}:${match[6]}` };
}

function shiftDateKey(value, days) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function saoPauloDateTimeKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}

function matchesOperationalDate(record, flight) {
  const operationalDate = saoPauloDateKey(flight.eta);
  if (!operationalDate) return false;
  if (record.assignedAt.dateKey === operationalDate) return true;
  if (record.assignedAt.dateKey !== shiftDateKey(operationalDate, -1)) return false;

  const etaKey = saoPauloDateTimeKey(flight.eta);
  const etaWallClock = Date.parse(`${etaKey}Z`);
  const assignedWallClock = Date.parse(`${record.assignedAt.sortKey}Z`);
  const difference = etaWallClock - assignedWallClock;
  return Number.isFinite(difference)
    && difference >= 0
    && difference <= ROLLOVER_LOOKBACK_HOURS * 60 * 60 * 1000;
}

function queryPeriod(arrivals, now = new Date()) {
  const dates = [saoPauloDateKey(now), ...arrivals.map((flight) => saoPauloDateKey(flight.eta))].filter(Boolean);
  dates.sort();
  return {
    startDate: shiftDateKey(dates[0], -1),
    endDate: dates.at(-1),
  };
}

function isActiveRecord(record) {
  const recordStatus = normalizeStatus(record.record_status);
  const attendanceStatus = normalizeStatus(record.attendance_status);
  if (INACTIVE_STATUSES.has(recordStatus) || INACTIVE_STATUSES.has(attendanceStatus)) return false;
  return ACTIVE_STATUSES.has(recordStatus) || ACTIVE_STATUSES.has(attendanceStatus);
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const assignedAt = wingletAssignedAt(record.assigned_at);
  const airline = normalizeCode(record.flight_airline);
  const flightNumber = normalizeFlightNumber(record.flight_number);
  if (
    normalizeStatus(record.attendance_direction) !== 'arrival'
    || !isActiveRecord(record)
    || !assignedAt
    || !airline
    || !flightNumber
  ) return null;

  return {
    recordId: cleanText(record.record_id),
    airline,
    flightNumber,
    origin: normalizeCode(record.flight_origin),
    destination: normalizeCode(record.flight_destination),
    aircraftRegistration: normalizeCode(record.aircraft_registration),
    assignedAt,
    completed: normalizeStatus(record.step_2_status) === 'completed',
    operatorName: cleanText(record.operator_1_name),
    operatorShift: cleanText(record.operator_1_shift),
  };
}

function operatorLabel(name, shift) {
  const firstName = cleanText(name).split(' ')[0].toLocaleUpperCase('pt-BR');
  const normalizedShift = cleanText(shift).toLocaleUpperCase('pt-BR');
  if (firstName && normalizedShift) return `${firstName} - ${normalizedShift}`;
  return firstName || normalizedShift;
}

function sameRoute(record, flight) {
  const origin = normalizeCode(flight.origin);
  const destination = normalizeCode(flight.destination);
  if (record.origin && origin && record.origin !== origin) return false;
  if (record.destination && destination && record.destination !== destination) return false;
  return true;
}

function candidatesForFlight(records, flight) {
  const identity = arrivalFlightIdentity(flight.flightNumber);
  if (!identity || !saoPauloDateKey(flight.eta)) return [];
  const registration = normalizeCode(flight.aircraftPrefix);

  const candidates = records.filter((record) => {
    if (record.airline !== identity.airline || record.flightNumber !== identity.number) return false;
    if (!matchesOperationalDate(record, flight) || !sameRoute(record, flight)) return false;
    return true;
  });

  if (!registration) return candidates;
  const sameRegistration = candidates.filter((record) => record.aircraftRegistration === registration);
  return sameRegistration.length ? sameRegistration : candidates;
}

class SmartFuelProvider {
  constructor({ client, logger = console } = {}) {
    this.client = client;
    this.logger = logger;
  }

  isConfigured() {
    return Boolean(this.client?.isConfigured());
  }

  async getStatuses(arrivals, now = new Date()) {
    if (!arrivals.length) return [];
    const period = queryPeriod(arrivals, now);
    const rawRecords = await this.client.getSmartFuelSummary(period);
    const records = rawRecords.map(normalizeRecord).filter(Boolean);
    const statuses = [];

    for (const flight of arrivals) {
      const candidates = candidatesForFlight(records, flight)
        .sort((a, b) => b.assignedAt.sortKey.localeCompare(a.assignedAt.sortKey));
      if (!candidates.length) continue;

      const newest = candidates[0];
      const tied = candidates.filter((candidate) => candidate.assignedAt.sortKey === newest.assignedAt.sortKey);
      if (tied.length > 1) {
        this.logger.warn(`[Smart Fuel] Associação ambígua para ${flight.flightNumber}; registro ignorado.`);
        continue;
      }

      statuses.push({
        operationId: flight.id,
        assigned: true,
        completed: newest.completed,
        teamName: operatorLabel(newest.operatorName, newest.operatorShift),
      });
    }

    return statuses;
  }
}

module.exports = {
  SmartFuelProvider,
  cleanText,
  normalizeCode,
  normalizeStatus,
  normalizeFlightNumber,
  arrivalFlightIdentity,
  wingletAssignedAt,
  shiftDateKey,
  saoPauloDateTimeKey,
  matchesOperationalDate,
  queryPeriod,
  isActiveRecord,
  normalizeRecord,
  operatorLabel,
  candidatesForFlight,
  ROLLOVER_LOOKBACK_HOURS,
};
