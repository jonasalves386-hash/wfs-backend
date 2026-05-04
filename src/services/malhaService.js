const axios = require('axios');
const { isHorarioValido, isDataValida, isHoje, minutosAteHorario } = require('../utils/parseHorario');

function normalizarTexto(valor) {
  return String(valor || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

function montarUrl() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = process.env.SHEET_NAME;
  const apiKey = process.env.GOOGLE_API_KEY;

  if (!sheetId || !sheetName || !apiKey) {
    throw new Error('Variáveis GOOGLE_SHEET_ID, SHEET_NAME e GOOGLE_API_KEY são obrigatórias no .env');
  }

  const range = `${encodeURIComponent(sheetName)}!B:Q`;
  return `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}&t=${Date.now()}`;
}

function minutosDesdeHorario(horario) {
  if (!isHorarioValido(horario)) return null;

  const [h, m] = horario.split(':').map(Number);
  const agora = new Date();
  const alvo = new Date();

  alvo.setHours(h, m, 0, 0);

  return Math.round((agora - alvo) / 60000);
}

function estaNaJanelaOperacional(horario, calco) {
  const tempo = minutosAteHorario(horario);

  if (tempo === null || tempo === undefined) return false;

  if (tempo > 60) return false;   // too far ahead, skip
  if (tempo >= -60) return true;  // within normal window

  // past the -60 min mark: keep only if no CALCO (delayed, not yet landed)
  return !calco;
}

function deveRemoverPorCalco(calco) {
  if (!isHorarioValido(calco)) return false;

  const minutos = minutosDesdeHorario(calco);

  if (minutos === null) return false;

  return minutos >= 2;
}

async function getVoos() {
  const url = montarUrl();

  const { data } = await axios.get(url, {
    headers: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });

  const rows = data.values;

  if (!rows || rows.length < 2) {
    console.log('[getVoos] Planilha vazia ou sem dados suficientes');
    return [];
  }

  const headersOriginais = rows[0].map(h => String(h || '').trim());
  const headers = headersOriginais.map(normalizarTexto);

  console.log('[getVoos] Headers originais:', headersOriginais);
  console.log('[getVoos] Headers normalizados:', headers);

  const findCol = (...names) => {
    const normalizados = names.map(normalizarTexto);

    for (const name of normalizados) {
      const indexExato = headers.indexOf(name);
      if (indexExato >= 0) return indexExato;
    }

    for (const name of normalizados) {
      const indexParcial = headers.findIndex(h => h.includes(name) || name.includes(h));
      if (indexParcial >= 0) return indexParcial;
    }

    return -1;
  };

  const idxData = findCol('DATA', 'DATE', 'DT');
  const idxVoo = findCol('VOO', 'NUMERO', 'N VOO', 'NUM VOO', 'FLIGHT', 'FLT');
  const idxOrigem = findCol(
    'ORIGEM',
    'ORIG',
    'ORG',
    'FROM',
    'ROTA',
    'ROUTE',
    'ORIGIN',
    'PROCEDENCIA',
    'AEROPORTO ORIGEM'
  );
  const idxHorario = findCol('STA', 'ETA', 'HORARIO', 'HORA', 'CHEGADA', 'ARRIVAL');
  const idxCalco = findCol('CALCO', 'CALÇO', 'POUSO', 'ATD', 'ON BLOCK', 'ONBLOCK');

  console.log('[getVoos] Mapeamento:', {
    idxData,
    idxVoo,
    idxOrigem,
    idxHorario,
    idxCalco,
    headerOrigem: idxOrigem >= 0 ? headersOriginais[idxOrigem] : null,
  });

  if (idxVoo < 0 || idxHorario < 0) {
    throw new Error(`Colunas obrigatórias não encontradas. Headers disponíveis: ${headersOriginais.join(', ')}`);
  }

  const voos = rows.slice(1)
    .map(row => {
      const voo = String(row[idxVoo] || '').trim();
      const origem = idxOrigem >= 0 ? String(row[idxOrigem] || '').trim() : '';
      const horario = String(row[idxHorario] || '').trim();
      const calcoBruto = idxCalco >= 0 ? String(row[idxCalco] || '').trim() : '';
      const dataLinha = idxData >= 0 ? String(row[idxData] || '').trim() : '';

      return {
        voo,
        origem,
        horario,
        calco: isHorarioValido(calcoBruto) ? calcoBruto : null,
        data: dataLinha,
        tempo: minutosAteHorario(horario) ?? 0,
      };
    })
    .filter(v => v.voo)
    .filter(v => isHorarioValido(v.horario))
    .filter(v => {
      if (idxData >= 0) {
        return isDataValida(v.data) && isHoje(v.data);
      }

      return true;
    })
    .filter(v => estaNaJanelaOperacional(v.horario, v.calco))
    .filter(v => !deveRemoverPorCalco(v.calco))
    .sort((a, b) => {
      const tempoA = minutosAteHorario(a.horario) ?? 9999;
      const tempoB = minutosAteHorario(b.horario) ?? 9999;
      return tempoA - tempoB;
    })
    .slice(0, 25)
    .map(v => ({
      voo: v.voo,
      origem: v.origem,
      horario: v.horario,
      calco: v.calco,
      tempo: v.tempo,
    }));

  console.log('[getVoos] Total final enviado ao frontend:', voos.length);
  console.log('[getVoos] Primeiros voos:', voos.slice(0, 5));

  return voos;
}

module.exports = { montarUrl, getVoos };