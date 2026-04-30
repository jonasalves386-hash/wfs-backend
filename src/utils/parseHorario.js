/**
 * parseHorario.js
 * ─────────────────────────────────────────────
 * Utilidades para validar e converter horários
 * vindos da planilha (que podem vir bagunçados).
 */

/**
 * Valida se a string está no formato HH:mm
 * Aceita: "08:21", "23:59", "00:00"
 * Rejeita: "8:21", ".", "push", "", null, undefined
 *
 * @param {string} horario
 * @returns {boolean}
 */
function isHorarioValido(horario) {
  if (!horario || typeof horario !== 'string') return false;

  // regex: HH:mm com 2 dígitos cada
  const regex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  return regex.test(horario.trim());
}

/**
 * Valida formato de data DD/MM/YYYY
 * Aceita: "29/04/2026"
 * Rejeita: "2026-04-29", ".", "", null
 *
 * @param {string} data
 * @returns {boolean}
 */
function isDataValida(data) {
  if (!data || typeof data !== 'string') return false;

  const regex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  if (!regex.test(data.trim())) return false;

  const [dia, mes, ano] = data.trim().split('/').map(Number);
  const d = new Date(ano, mes - 1, dia);
  return d.getDate() === dia && d.getMonth() === mes - 1 && d.getFullYear() === ano;
}

/**
 * Verifica se uma data DD/MM/YYYY é hoje
 *
 * @param {string} data
 * @returns {boolean}
 */
function isHoje(data) {
  if (!isDataValida(data)) return false;

  const [dia, mes, ano] = data.trim().split('/').map(Number);
  const hoje = new Date();

  return (
    dia === hoje.getDate() &&
    mes === hoje.getMonth() + 1 &&
    ano === hoje.getFullYear()
  );
}

/**
 * Calcula minutos restantes até o horário do voo
 * Retorna negativo se já passou
 *
 * @param {string} horario - formato HH:mm
 * @returns {number} minutos (pode ser negativo)
 */
function minutosAteHorario(horario) {
  if (!isHorarioValido(horario)) return null;

const [h, m] = horario.trim().split(':').map(Number);

const agora = new Date();
const alvo = new Date();

alvo.setHours(h, m, 0, 0);

// se o horário já passou muito (ex: mais de 12h atrás), assume próximo dia
if (alvo < agora && (agora - alvo) > 12 * 60 * 60 * 1000) {
  alvo.setDate(alvo.getDate() + 1);
}

  return Math.floor((alvo - agora) / 60000);
}

module.exports = {
  isHorarioValido,
  isDataValida,
  isHoje,
  minutosAteHorario,
};