'use strict';

/**
 * Contratos internos do Painel de Chegadas.
 *
 * O projeto continua em JavaScript, portanto os tipos abaixo usam JSDoc para
 * documentar e validar as fronteiras entre providers, regra de negócio e UI.
 */

/**
 * @typedef {Object} ArrivalFlight
 * @property {string} id Identificador técnico e estável da operação na Malha/SIGA.
 * @property {string|null} aircraftPrefix Prefixo da aeronave usado para excluir Wide Body.
 * @property {string} serviceKey Chave data + voo usada por sistemas operacionais legados.
 * @property {string} flightNumber Número apresentado no painel.
 * @property {string|null} origin
 * @property {string|null} destination
 * @property {string|null} eta Timestamp ISO fornecido exclusivamente pela Malha.
 * @property {string|null} box Posição BOX da chegada (`park_position_arrival`).
 * @property {string|null} paxDoorOpen Horário de abertura da porta de passageiros (`pax_door_open`).
 * @property {boolean} chocksOn
 * @property {boolean} gateOpen
 * @property {string|null} rawStatus
 */

/**
 * @typedef {Object} FoniaAssignment
 * @property {string} operationId
 * @property {'ARRIVAL'} leg
 * @property {string} teamName
 * @property {boolean} inPosition
 */

/**
 * @typedef {Object} RestStatus
 * @property {string} serviceKey
 * @property {boolean} assigned
 */

/**
 * @typedef {ArrivalFlight & {
 *   fonia: {teamName: string, inPosition: boolean},
 *   rest: {assigned: boolean},
 *   smartFuel: {assigned: boolean, completed: boolean, teamName: string}
 * }} PanelFlight
 */

module.exports = {};
