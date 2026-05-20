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

function extrairHorario(valor) {
  const texto = String(valor || '').trim();
  const match = texto.match(/([01]\d|2[0-3]):[0-5]\d/);
  return match ? match[0] : '';
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
  const range = encodeURIComponent('NARROW') + '!A:Q';
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
    qta1:   String(row[9] || '').trim(),
    qta2:   String(row[10] || '').trim(),
    qtu1:   String(row[15] || '').trim(),
    qtu2:   String(row[16] || '').trim(),
  }));
}

async function getSmartFuel() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_API_KEY não definida');

  const sheetId = '1OYyGTUYqlaQvp0xWZ9Bys-8EmxFf12CEjbuPb8E0F-w';
  const range = encodeURIComponent('SMART FUEL') + '!B:AM';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}&t=${Date.now()}`;

  const { data } = await axios.get(url, {
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  });

  const rows = data.values;
  if (!rows || rows.length < 2) return [];

  const resultado = rows.slice(1).map(row => ({
    data:   String(row[0] || '').trim(),
    voo:    String(row[1] || '').trim(),
    ori:    String(row[2] || '').trim(),
    equipe: String(row[37] || '').trim(),
  }));

  return resultado;
}


function smartFuelEstaEscalado(valor) {
  const texto = normalizarOperadorSmartFuel(valor);

  if (!texto) return false;

  for (const operador of SMART_FUEL_OPERADORES_VALIDOS) {
    if (texto.includes(operador) || operador.includes(texto)) {
      return true;
    }
  }

  return false;
}

function normalizarOperadorSmartFuel(valor) {
  return String(valor || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+T([1-4])\b/g, '-T$1')
    .replace(/\s+/g, ' ');
}

function temNomeValido(valor) {
  const texto = String(valor || '').trim();

  if (!texto) return false;
  if (['-', 'OK', 'N/A', 'NA'].includes(texto.toUpperCase())) return false;

  return /[A-Za-zÀ-ÿ]{2,}/.test(texto);
}

function duplaEscalada(a, b) {
  return temNomeValido(a) && temNomeValido(b);
}

const FONIA_EQUIPES_VALIDAS_RAW = [
'ALFA - T1', 'ALFA-T2', 'ALFA-T3', 'ALFA -T4', 'BETA - T1', 'BETA-T2', 'BETA- T3', 'BETA- T4', 'BLUE-T1', 'BLUE-T2', 'BLUE-T3', 'BLUE-T4', 'BRAVO - T1', 'BRAVO - T2',
'BRAVO - T3', 'BRAVO - T4', 'BRONZE- T2', 'BRONZE- T3', 'CHARLIE - T1', 'CHARLIE- T2', 'CHARLIE - T3', 'CHARLIE - T4', 'DELTA - T1', 'DELTA - T2', 'DELTA - T3', 'DELTA - T4',
'DIAMANTE- T1', 'DIAMANTE - T2', 'DIAMANTE - T3', 'DIAMANTE - T4', 'ECHO-T1', 'ECHO-T2', 'ECHO-T3', 'ECHO-T4', 'ELITE - T2', 'FENIX - T2', 'FERRARI - T2', 'FOXTROT -T1',
'FOXTROT-T2', 'FOXTROT -T3', 'FOXTROT- T4', 'GOLDEN-T1', 'GOLDEN-T2', 'GOLDEN-T3', 'GOLDEN-T4', 'GOLF-T1', 'GOLF-T2', 'GOLF-T3', 'GOLF- T4', 'HOTEL-T1', 'HOTEL-T2', 'HOTEL-T3',
'HOTEL-T4', 'INDIA - T1', 'INDIA - T2', 'INDIA - T3', 'INDIA - T4', 'JULIET - T1', 'JULIET - T2', 'JULIET-T3', 'JULIET- T4', 'KILO- T1', 'KILO- T2', 'KILO- T3', 'KILO- T4',
'LIMA -T1', 'LIMA - T2', 'LIMA - T3', 'LIMA - T4', 'MIKE - T1', 'MIKE - T2', 'MIKE - T3', 'MIKE - T4', 'NOVEMBER-T2', 'NOVEMBER-T3', 'NOVEMBER-T4', 'OSCAR-T1', 'OSCAR-T2',
'OSCAR-T3', 'OSCAR- T4', 'PAPA - T1', 'PAPA - T2', 'PAPA - T3', 'PAPA - T4', 'PRATA- T3', 'QUEBEC-T1', 'QUEBEC-T2', 'QUEBEC-T3', 'QUEBEC-T4', 'RED-T1', 'RED-T2', 'RED-T3',
'RED-T4', 'ROMA-T1', 'ROMA-T2', 'ROMA-T3', 'ROMA-T4', 'ROMEO- T1', 'ROMEO - T2', 'ROMEO-T3', 'ROMEO - T4', 'SIERRA - T1', 'SIERRA - T2', 'SIERRA - T3', 'SIERRA - T4',
'SILVER-T1', 'SILVER-T2', 'SILVER-T3', 'SILVER-T4', 'TANGO - T1', 'TANGO - T2', 'TANGO - T3', 'TANGO- T4', 'TITANIUM- T2', 'TITANIUM- T3', 'UNIFORM- T1', 'UNIFORM - T2',
'UNIFORM - T3', 'UNIFORM - T4', 'VICTOR- T1', 'VICTOR - T2', 'VICTOR- T3', 'VICTOR - T4', 'WHISKEY - T1', 'WHISKEY -T2', 'WHISKEY - T3', 'WHISKEY - T4', 'X RAY - T1', 'X RAY -T2',
'X RAY-T3', 'X RAY- T4', 'XADREZ-T3', 'XADREZ - T4', 'YANKEE-T1', 'YANKEE - T2', 'YANKEE-T3', 'YANKEE - T4', 'YELLOW-T1', 'YELLOW- T2', 'YELLOW- T3', 'YELLOW- T4', 'ZULU - T1',
'ZULU- T2', 'ZULU- T3', 'ZULU - T4', 'ELITE - T3', 'TRASLADO', 'ELITE -T4', 'FENIX - T3', 'FENIX - T4', 'TITANIUM- T4', 'BRONZE - T4', 'PRATA- T4','APOIO - T1', 'APOIO - T2',
'APOIO - T3', 'APOIO - T4', 'DOURADOS - T1', 'DOURADOS - T2', 'DOURADOS - T3', 'DOURADOS - T4',
];

function normalizarEquipeFonia(valor) {
  return String(valor || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*-\s*/g, '-')
    .replace(/\bAPOIO\s+T([1-4])\b/g, 'APOIO-T$1')
    .replace(/\s+/g, ' ');
}

const FONIA_EQUIPES_VALIDAS = new Set(
  FONIA_EQUIPES_VALIDAS_RAW.map(normalizarEquipeFonia)
);

function ehApoioValidoFonia(valor) {
  const texto = normalizarEquipeFonia(valor);

  return /^APOIO-T[1-4](\s+.*)?$/.test(texto);
}

function contemEquipeValidaFonia(valor) {
  const texto = normalizarEquipeFonia(valor);

  if (!texto) return false;

  for (const equipe of FONIA_EQUIPES_VALIDAS) {
    if (texto.includes(equipe)) {
      return true;
    }
  }

  return /(^|\s)APOIO-T[1-4](\s|$)/.test(texto);
}

function foniaEstaEscalada(a, b) {
  return (
    contemEquipeValidaFonia(a) ||
    contemEquipeValidaFonia(b)
  );
}

const SMART_FUEL_OPERADORES_VALIDOS_RAW = ['CARLOS ALBERTO DA SILVA REZENDE - T1', 'DIHONE ASSUNÇÃO DOS SANTOS  - T1', 'EMERSON DAVILA FERREIRA DUARTE - T1',
  'GABRIEL DE LIMA ALVES - T1', 'RENATO BEZERRA PAULINO - T1', 'SAMUEL FRANÇA DOS SANTOS - T1', 'UBERLAN SANTOS DE OLIVEIRA - T1', 'VALDEMIR VIERA DOS SANTOS - T1',
  'NAILTON RAMOS DOS SANTOS - T1', 'EVANDRO ROBERIO SOARES PEREIRA - T1', 'VICENT DENIS OLIVEIRA DA COSTA - T1', 'ANDERSON JUSTINO DA SILVA - T1', 'PAULO LUCAS DE SOUZA - T1',
  'ADELINO ROBERTO F. JUNIOR - T2', 'ANDERSON DOS SANTOS - T2', 'CARLOS HENRIQUE COELHO DE ALMEIDA - T2', 'CLAUDECIR DOS SANTOS CARDOSO - T2', 'CLAUDEMIR BARBOSA DA CONCEICAO - T2',
  'DANIEL SILVESTRE - T2', 'DAYVID DJALMA DA SILVA - T2', 'DELMARX SOARES OLIVEIRA - T2', 'ERIK GOMES DA SILVA - T2', 'ESMERALDO FERNANDES DOS SANTOS - T2',
  'IVAN LUCAS DA SILVA - T2', 'JAILSON CORDEIRO DA SILVA - T2', 'JOANILSON SILVA TEXEIRA - T2', 'JOSIVALDO SILVA DE OLIVEIRA - T2', 'LEONARDO CIRINO MORAIS - T2',
  'MARCELO ELIAS RIBEIRO MOREIRA - T2', 'RICARDO DO NASCIMENTO-T2', 'SILVANO CARLOS MUNARIM - T2', 'MIGUEL PAIXÃO DA SILVA - T2', 'HAMILTON SOARES DE ARAUJO FILHO - T2',
  'VAGNER DA SILVA NEGRONI - T2', 'ELISÂNIO SOUZA - T2', 'WESLEY ALVES ARAUJO - T2', 'ALEXANDRE - T3', 'ANDERSON DE LOURDES - T3', 'EDVALDO - T3', 'EILSON DE ABREU BORGES - T3',
  'EMERSON - T3', 'GABRIEL RODRIGUES MARQUES - T3', 'JEFFERSON COSTA - T3', 'JEFFERSON DOS SANTOS VENTURA - T3', 'JESIEL DA SILVA RODRIGUES - T3', 'JONAS HENRIQUE SANTOS LIMA - T3',
  'JONAS DIOGO OLIVEIRA DE ALMEIDA - T3', 'MARCELO NASCIMENTO DE OLIVEIRA - T3', 'MARCOS - T3', 'MARTA - T3', 'PAULO MENDONCA DE OLIVEIRA SANTOS - T3', 'REGINALDO NASCIMENTO AVELINO - T3',
  'REYKJAVIK SOUZA AGUIAR - T3', 'RICARDO HENRIQUE OLIVEIRA DA SILVA - T3', 'ROLEMBERG RIBEIRO DE OLIVEIRA - T3', 'VANDERSON - T3', 'AFONSO - T4', 'ANTONIO - T4', 'BRENO - T4',
  'CARLOS - T4', 'DANIEL - T4', 'EDSON - T4', 'EDUARDO ROQUE - T4', 'JONATAN - T4', 'JOSE - T4', 'LEANDRO - T4', 'LUAN - T4', 'LUIZ - T4', 'MARCIO MANUEL - T4', 'MARCOS ROCHA - T4', 'MAURO - T4',
  'PETER - T4', 'REGIO - T4', 'RODRIGO - T4', 'SANDRO - T4', 'VALMIR - T4', 'JILSON XAVIER - T4', 'WESLEY MARCIANO ISIDORO - T3', 'JOÃO CARLOS - T4', 'MAURICIO COSTA - T3', 'MARCELO - T4',
  'MARCIO GOMES -T3', 'LUIS PACHECO - T3', 'ALCIDES PEREIRA VIANA - T4', 'REMERSON SOARES - T4', 'LEONARDO AUX  - ', 'RICARDO AUX - ', 'WILLIAN - T3', 'JOEL  - T4', 'ALEX  - T3',
  'LEANDRO - T3'];

function normalizarOperadorSmartFuel(valor) {
  return String(valor || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ');
}

const SMART_FUEL_OPERADORES_VALIDOS = new Set(
  SMART_FUEL_OPERADORES_VALIDOS_RAW.map(normalizarOperadorSmartFuel)
);

function smartFuelEstaEscalado(valor) {
  const texto = normalizarOperadorSmartFuel(valor);

  if (!texto) return false;

  for (const operador of SMART_FUEL_OPERADORES_VALIDOS) {
    if (texto.includes(operador) || operador.includes(texto)) {
      return true;
    }
  }

  return false;
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

function estaNaJanelaOperacional(horario) {
  const tempo = minutosAteHorario(horario);

  if (tempo === null || tempo === undefined) return false;

  return tempo >= -60 && tempo <= 60;
}

function deveRemoverPorCalco(calco) {
  if (!isHorarioValido(calco)) return false;

  const minutos = minutosDesdeHorario(calco);

  if (minutos === null) return false;

  return minutos >= 2;
}

async function getRestituicaoBag() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_API_KEY não definida');

  const sheetId = '11sPIGtgxFgMkb1aEOAWA_kdugs8rKfyFJFNYyCzpoHE';
  const range = encodeURIComponent('OPERACAO_DIA') + '!A:Z';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}&t=${Date.now()}`;

  const { data } = await axios.get(url, {
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  });

  const rows = data.values;
  if (!rows || rows.length < 2) return [];

  return rows.slice(1).map(row => ({
    operador: String(row[15] || '').trim(), // P
    confirmado: String(row[16] || '').trim().toUpperCase() === 'TRUE', // Q checkbox
    chave: normalizarTexto(row[25] || ''), // Z = DATA+VOO
  }));
}

async function getVoos() {
  const url = montarUrl();

const [progResult, limpezaResult, smartFuelResult, monitorResult, restituicaoResult] = await Promise.allSettled([
  axios.get(url, { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } }),
  getLimpeza(),
  getSmartFuel(),
  getMonitorChegada(),
  getRestituicaoBag(),
]);

  if (progResult.status === 'rejected') throw progResult.reason;
  const { data } = progResult.value;

  const limpeza = limpezaResult.status === 'fulfilled' ? limpezaResult.value : [];
  if (limpezaResult.status === 'rejected') {
    console.warn('[getVoos] Falha ao buscar LIMPEZA, continuando sem ela:', limpezaResult.reason?.message);
  }

  const smartFuel = smartFuelResult.status === 'fulfilled' ? smartFuelResult.value : [];
if (smartFuelResult.status === 'rejected') {
  console.warn('[getVoos] Falha ao buscar SMART FUEL, continuando sem ele:', smartFuelResult.reason?.message);
}

const monitorChegada = monitorResult.status === 'fulfilled' ? monitorResult.value : [];

if (monitorResult.status === 'rejected') {
  console.warn('[getVoos] Falha ao buscar MONITOR CHEGADA, usando ETA/CALÇO da PROG:', monitorResult.reason?.message);
}

const restituicao = restituicaoResult.status === 'fulfilled' ? restituicaoResult.value : [];

if (restituicaoResult.status === 'rejected') {
  console.warn('[getVoos] Falha ao buscar RESTITUIÇÃO BAG, continuando sem ela:', restituicaoResult.reason?.message);
}

const monitorMap = new Map();

for (const linha of monitorChegada) {
  const chave = `${normalizarTexto(linha.data)}|${normalizarTexto(linha.voo)}|${normalizarTexto(linha.ori)}`;
  monitorMap.set(chave, linha);
}

  const limpezaMap = new Map();

  for (const linha of limpeza) {
    const chave = `${normalizarTexto(linha.data)}|${normalizarTexto(linha.voo)}|${normalizarTexto(linha.ori)}`;
    limpezaMap.set(chave, linha);
  }

const smartFuelMap = new Map();

for (const linha of smartFuel) {
  const chave = `${normalizarTexto(linha.data)}|${normalizarTexto(linha.voo)}`;
  smartFuelMap.set(chave, linha);
}

const restituicaoMap = new Map();

for (const linha of restituicao) {
  if (linha.chave) {
    restituicaoMap.set(linha.chave, linha);
  }
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
    const horarioProg = extrairHorario(row[idxHorario]);
    const calcoProg = idxCalco >= 0 ? extrairHorario(row[idxCalco]) : '';
    const dataLinha = idxData >= 0 ? String(row[idxData] || '').trim() : '';

    const fonia1 = String(row[12] || '').trim();
    const fonia2 = String(row[13] || '').trim();

    return {
      voo,
      origem,
      horario: horarioProg,
      calco: isHorarioValido(calcoProg) ? calcoProg : null,
      data: dataLinha,
      tempo: minutosAteHorario(horarioProg) ?? 0,
      fonia1,
      fonia2,
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
  .filter(v => estaNaJanelaOperacional(v.horario))

  .sort((a, b) => {
  const tempoA = minutosAteHorario(a.horario) ?? 9999;
  const tempoB = minutosAteHorario(b.horario) ?? 9999;
  return tempoA - tempoB;
  })

.map(v => {
  const chave = `${normalizarTexto(v.data)}|${normalizarTexto(v.voo)}|${normalizarTexto(v.origem)}`;
  const chaveSmartFuel = `${normalizarTexto(v.data)}|${normalizarTexto(v.voo)}`;
  const chaveRestituicao = `${normalizarTexto(v.data)}${normalizarTexto(v.voo)}`;

  const monitor = monitorMap.get(chave);
  const horarioFinal = monitor?.eta || v.horario;
  const calcoFinal = monitor?.calco || v.calco;

  const linhaServico = limpezaMap.get(chave);
  const linhaSmartFuel = smartFuelMap.get(chaveSmartFuel);
  const linhaRestituicao = restituicaoMap.get(chaveRestituicao);

  const valorLimpeza = linhaServico?.equipe ?? '';
  const valorSmartFuel = linhaSmartFuel?.equipe ?? '';
  const valorRestituicao = linhaRestituicao?.operador ?? '';
  const limpezaEscalada = limpezaEstaEscalada(valorLimpeza);
  const restituicaoEscalada = Boolean(linhaRestituicao?.confirmado && valorRestituicao);

  return {
    voo: v.voo,
    origem: v.origem,
    horario: horarioFinal,
    calco: calcoFinal,
    data: v.data,
    tempo: minutosAteHorario(horarioFinal) ?? v.tempo,
    servicos: {
      limpeza: {
        escalado: limpezaEscalada,
        valor: valorLimpeza,
      },
      fonia: {
        escalado: foniaEstaEscalada(v.fonia1, v.fonia2),
        valor: `${v.fonia1 || ''} | ${v.fonia2 || ''}`.trim(),
      },
      qta: {
        escalado: duplaEscalada(linhaServico?.qta1, linhaServico?.qta2),
        valor: `${linhaServico?.qta1 || ''} | ${linhaServico?.qta2 || ''}`.trim(),
      },
      qtu: {
        escalado: duplaEscalada(linhaServico?.qtu1, linhaServico?.qtu2),
        valor: `${linhaServico?.qtu1 || ''} | ${linhaServico?.qtu2 || ''}`.trim(),
      },
      smartfuel: {
        escalado: smartFuelEstaEscalado(valorSmartFuel),
        valor: valorSmartFuel,
      },
      restituiçao: {
        escalado: restituicaoEscalada,
        valor: valorRestituicao,
      },
    },
  };
})

  .filter(v => {
  const tempo = minutosAteHorario(v.horario);

  if (tempo === null || tempo === undefined) return true;

  return !(
  tempo <= 0 &&
  v.servicos.limpeza.escalado &&
  v.servicos.fonia.escalado
  );
})


.slice(0, 15);

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