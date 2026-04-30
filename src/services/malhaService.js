/**
 * malhaService.js
 * ─────────────────────────────────────────────
 * Responsável por:
 * 1. Buscar dados na Google Sheets API
 * 2. Filtrar voos válidos do dia atual
 * 3. Calcular tempo restante e status
 * 4. Devolver array limpo pra rota /voos
 */

const axios = require('axios');
const {
  isHorarioValido,
  isHoje,
  minutosAteHorario,
} = require('../utils/parseHorario');

/**
 * Monta a URL da API do Google Sheets a partir do .env
 * Lê o range B:Q da aba (cobre DATA, VOO, ORIGEM e ETA).
 */
function montarUrl() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = process.env.SHEET_NAME;
  const apiKey = process.env.GOOGLE_API_KEY;

  if (!sheetId || !sheetName || !apiKey) {
    throw new Error(
      'Variáveis GOOGLE_SHEET_ID, SHEET_NAME e GOOGLE_API_KEY são obrigatórias no .env'
    );
  }

  // encodeURIComponent cuida de espaços e caracteres especiais no nome da aba
  const range = `${encodeURIComponent(sheetName)}!B:Q`;

  return `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`;
}

/**
 * Define o status do voo com base nos minutos restantes
 * Regras:
 *   tempo < 0    → ATRASADO
 *   tempo <= 15  → URGENTE
 *   tempo <= 40  → ATENCAO
 *   resto        → NORMAL
 */
function definirStatus(tempo) {
  if (tempo < 0) return 'ATRASADO';
  if (tempo <= 15) return 'URGENTE';
  if (tempo <= 40) return 'ATENCAO';
  return 'NORMAL';
}

/**
 * Converte uma linha bruta da planilha em objeto de voo.
 * Retorna null se a linha for inválida.
 *
 * Layout das colunas na planilha (offset 0 porque pegamos B:Q):
 *   índice 0  → B → DATA
 *   índice 1  → C → VOO
 *   índice 2  → D → ORIGEM
 *   índice 15 → Q → ETA
 */
function processarLinha(linha) {
  // linhas curtas demais (faltando colunas) já são descartadas
  if (!Array.isArray(linha) || linha.length < 16) return null;

  const data = (linha[0] || '').toString().trim();
  const voo = (linha[1] || '').toString().trim();
  const origem = (linha[2] || '').toString().trim();
  const calco = (linha[4] || '').toString().trim();
  const horario = (linha[15] || '').toString().trim();

  // filtros: dia atual + horário válido + voo presente
  if (!isHoje(data)) return null;
  if (!isHorarioValido(horario)) return null;
  if (!voo) return null;

  const tempo = minutosAteHorario(horario);
  const status = definirStatus(tempo);
  
  if (deveRemover(tempo, calco)) {
  return null;
}

  return {
    voo,
    origem: origem || '-',
    horario,
    tempo,
    status,
    calco,
  };
}

function deveRemover(tempo, calco) {
  if (tempo > 0) return false;

  if (!calco) return false;

  if (!isHorarioValido(calco)) return false;

  const agora = new Date();

  const [h, m] = calco.split(':').map(Number);

  const dataCalco = new Date();
  dataCalco.setHours(h, m, 0, 0);

  const diffMin = (agora - dataCalco) / 60000;

  return diffMin >= 3;
}

/**
 * Filtra voos dentro da janela de 1 hora a partir de agora.
 * Voos atrasados (tempo < 0) também ficam — o painel precisa deles.
 */
function dentroDaJanela(voo) {
  // Atrasados sempre permanecem
  if (voo.tempo < 0) return true;
  // Próximos 60 minutos
  return voo.tempo <= 60;
}

/**
 * Função principal — chamada pela rota /voos
 * Faz toda a orquestração: busca, filtra, ordena.
 */
async function getVoos() {
  try {
    const url = montarUrl();
    const response = await axios.get(url, { timeout: 50000 });

    const linhas = response.data.values || [];

    // pula a primeira linha (cabeçalho da planilha)
    const dados = linhas.slice(1);

    const voos = dados
      .map(processarLinha)
      .filter(Boolean)             // remove os null
      .filter(dentroDaJanela)
      .sort((a, b) => a.tempo - b.tempo);

    return voos;
  } catch (err) {
    // log claro pra debug, mas não derruba o servidor
    console.error('[malhaService] Erro ao buscar voos:', err.message);
    throw new Error('Falha ao consultar a planilha');
  }
}

module.exports = { getVoos };