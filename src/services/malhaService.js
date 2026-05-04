const axios = require('axios');
const { isHorarioValido, isDataValida, isHoje, minutosAteHorario } = require('../utils/parseHorario');

function montarUrl() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = process.env.SHEET_NAME;
  const apiKey = process.env.GOOGLE_API_KEY;

  if (!sheetId || !sheetName || !apiKey) {
    throw new Error(
      'Variáveis GOOGLE_SHEET_ID, SHEET_NAME e GOOGLE_API_KEY são obrigatórias no .env'
    );
  }

  const range = `${encodeURIComponent(sheetName)}!B:Q`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`;

  console.log('[DEBUG] sheetId:', sheetId);
  console.log('[DEBUG] sheetName:', sheetName);
  console.log('[DEBUG] range:', range);
  console.log('[DEBUG] URL completa:', url);

  return url;
}

async function getVoos() {
  const url = montarUrl();

  const { data } = await axios.get(url);
  const rows = data.values;

  if (!rows || rows.length < 2) {
    console.log('[getVoos] Planilha vazia ou sem dados suficientes');
    return [];
  }

  const headers = rows[0].map(h => String(h || '').trim().toUpperCase());
  console.log('[getVoos] Headers encontrados:', headers);

  const findCol = (...names) => {
    for (const name of names) {
      const i = headers.indexOf(name);
      if (i >= 0) return i;
    }
    return -1;
  };

  const idxData    = findCol('DATA');
  const idxVoo     = findCol('VOO', 'NUMERO', 'NUM', 'FLIGHT');
  const idxOrigem  = findCol('ORIGEM', 'ROTA', 'ROUTE', 'ORIGIN');
  const idxHorario = findCol('STA', 'ETA', 'HORARIO', 'HORA', 'CHEGADA');
  const idxCalco   = findCol('CALCO', 'CALÇO', 'POUSO', 'ATD');

  console.log('[getVoos] Mapeamento:', { idxData, idxVoo, idxOrigem, idxHorario, idxCalco });

  if (idxVoo < 0 || idxHorario < 0) {
    throw new Error(
      `Colunas obrigatórias não encontradas. Headers disponíveis: ${headers.join(', ')}`
    );
  }

  return rows.slice(1)
    .filter(row => {
      const horario = String(row[idxHorario] || '').trim();
      if (!isHorarioValido(horario)) return false;
      if (idxData >= 0) {
        const data = String(row[idxData] || '').trim();
        return isDataValida(data) && isHoje(data);
      }
      return true;
    })
    .map(row => {
      const horario = String(row[idxHorario] || '').trim();
      const calco   = idxCalco >= 0 ? String(row[idxCalco] || '').trim() : '';
      return {
        voo:    String(row[idxVoo]    || '').trim(),
        origem: String(row[idxOrigem] || '').trim(),
        horario,
        calco:  isHorarioValido(calco) ? calco : null,
        tempo:  minutosAteHorario(horario) ?? 0,
      };
    })
    .filter(v => v.voo);
}

module.exports = { montarUrl, getVoos };
