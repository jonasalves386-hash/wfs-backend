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