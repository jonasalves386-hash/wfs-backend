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

// Válido: pelo menos um par HH:MM + NOME ou NOME + HH:MM (nome = 2+ letras consecutivas)
function limpezaEstaEscalada(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return false;
  return /([01]\d|2[0-3]):[0-5]\d\s+[A-Za-zÀ-ÿ]{2,}|[A-Za-zÀ-ÿ]{2,}\s+([01]\d|2[0-3]):[0-5]\d/.test(texto);
}

async function getLimpeza() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_API_KEY não definida');

  const sheetId = '17ggPnOyf-xzDX8WWgGhKGyf0fkwiCvmWZhLbYEup8Eo';
  const range = encodeURIComponent('NARROW') + '!A:G';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}&t=${Date.now()}`;

  const { data } = await axios.get(url, {
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  });

  const rows = data.values;
  if (!rows || rows.length < 2) return [];

  return rows.slice(1).map(row => ({
    data:   String(row[0] || '').trim(), // A = DATA
    voo:    String(row[1] || '').trim(), // B = VOO
    ori:    String(row[2] || '').trim(), // C = ORI
    equipe: String(row[6] || '').trim(), // G = EQUIPE LIMPEZA
  }));
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

// Delegates to minutosAteHorario (already timezone-aware for America/Sao_Paulo)
// so there is no separate timezone logic to maintain here.
function minutosDesdeHorario(horario) {
  const ate = minutosAteHorario(horario);
  return ate === null ? null : -ate;
}

function estaNaJanelaOperacional(horario, calco) {
  const tempo = minutosAteHorario(horario);

  if (tempo === null || tempo === undefined) return false;

  if (tempo > 60) return false;         // too far in the future
  if (tempo >= -60) return true;        // within normal window

  // Past -60 min: keep only if CALCO is filled (rule 5 — deveRemoverPorCalco handles the 2-min cutoff)
  // If CALCO is empty the flight is past its window and should leave (rule 4)
  return isHorarioValido(calco);
}

function deveRemoverPorCalco(calco) {
  if (!isHorarioValido(calco)) return false;

  const minutos = minutosDesdeHorario(calco);

  if (minutos === null) return false;

  return minutos >= 2;
}

async function getVoos() {
  const url = montarUrl();

  const [progResult, limpezaResult] = await Promise.allSettled([
    axios.get(url, { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } }),
    getLimpeza(),
  ]);

  if (progResult.status === 'rejected') throw progResult.reason;
  const { data } = progResult.value;

  const limpeza = limpezaResult.status === 'fulfilled' ? limpezaResult.value : [];
  if (limpezaResult.status === 'rejected') {
    console.warn('[getVoos] Falha ao buscar LIMPEZA, continuando sem ela:', limpezaResult.reason?.message);
  }

  const limpezaMap = new Map();
  for (const linha of limpeza) {
    const chave = `${normalizarTexto(linha.data)}|${normalizarTexto(linha.voo)}|${normalizarTexto(linha.ori)}`;
    limpezaMap.set(chave, linha.equipe);
  }

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
  const idxHorario = findCol('ETA', 'STA', 'HORARIO', 'HORA', 'CHEGADA', 'ARRIVAL');
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
    .slice(0, 15)
    .map(v => {
      const chave = `${normalizarTexto(v.data)}|${normalizarTexto(v.voo)}|${normalizarTexto(v.origem)}`;
      const valorLimpeza = limpezaMap.get(chave) ?? '';
      return {
        voo: v.voo,
        origem: v.origem,
        horario: v.horario,
        calco: v.calco,
        tempo: v.tempo,
        servicos: {
          limpeza: {
            escalado: limpezaEstaEscalada(valorLimpeza),
            valor: valorLimpeza,
          },
        },
      };
    });

  console.log('[getVoos] Total voos PROG (após filtro):', voos.length);
  console.log('[getVoos] Total linhas LIMPEZA:', limpeza.length);

  const matchesLimpeza = voos.filter(v => v.servicos.limpeza.escalado);
  console.log('[getVoos] Matches LIMPEZA escalados:', matchesLimpeza.length);
  if (matchesLimpeza.length > 0) {
    console.log('[getVoos] Primeiros matches:', matchesLimpeza.slice(0, 3).map(v => ({
      voo: v.voo, origem: v.origem, limpeza: v.servicos.limpeza.valor,
    })));
  }

  return voos;
}

module.exports = { montarUrl, getVoos };