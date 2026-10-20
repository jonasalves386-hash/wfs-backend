'use strict';

/**
 * Regra da escada na chegada, pela posição (BOX) e pela origem do voo.
 * Usada quando a Fonia ainda não informou `escada_necessaria` (o checklist só
 * existe depois que a equipe salva no mobile).
 *
 *   Ilha (114, 115), Pátio 100 (109–206), MOP (407–506),
 *   Pátios 6 e 7 / Remotas (607–715)        → ESCADA OBRIGATÓRIA
 *   T2 Oeste (207–306) e T2 Leste (307–406) → NÃO OBRIGATÓRIA
 *   Terminal 3 (507–606): origem nacional    → OBRIGATÓRIA
 *                         origem estrangeira → desconhecida (a perna de saída
 *                         pode ser nacional e o painel não a conhece)
 *   Fora das faixas                          → desconhecida
 *
 * Retorna true, false ou null (desconhecida = sem sinal, nunca alarme).
 */

const REGIONS = [
  { name: 'Pátio 100 / Ilha', from: 109, to: 206, stairs: true },
  { name: 'T2 Oeste', from: 207, to: 306, stairs: false },
  { name: 'T2 Leste', from: 307, to: 406, stairs: false },
  { name: 'MOP', from: 407, to: 506, stairs: true },
  { name: 'Terminal 3', from: 507, to: 606, stairs: 'terminal3' },
  { name: 'Pátios 6 e 7 / Remotas', from: 607, to: 715, stairs: true },
];

// Aeroportos nacionais atendidos nas chegadas de GRU (IATA).
const BRAZILIAN_AIRPORTS = new Set(`
  AJU ALT ARU ATM BEL BPS BSB BVB BYO CAC CAW CFB CGB CGH CGR CKS CLV CMG CNF CPV CWB CXJ
  CZS DOU FEN FLN FOR GIG GPB GRU GVR GYN IGU IMP IOS IPN IZA JDF JDO JJD JJG JOI JPA JPR
  JTC LDB LEC MAB MAO MCP MCZ MEA MGF MII MOC MVF NAT NVT OPS PET PFB PHB PLU PMW PNZ POA
  PPB PVH RAO RBR REC RIA ROO SDU SJK SJP SLZ SSA STM TFF THE TJL UBA UDI UNA URG VAG VCP
  VDC VIX XAP
`.trim().split(/\s+/));

function boxNumber(box) {
  const match = String(box || '').trim().match(/^(\d{3})/);
  return match ? Number(match[1]) : null;
}

function stairsRequiredFor(flight) {
  const number = boxNumber(flight?.box);
  if (number === null) return null;
  const region = REGIONS.find((item) => number >= item.from && number <= item.to);
  if (!region) return null;
  if (region.stairs !== 'terminal3') return region.stairs;
  const origin = String(flight.origin || '').trim().toUpperCase();
  return BRAZILIAN_AIRPORTS.has(origin) ? true : null;
}

module.exports = { stairsRequiredFor, boxNumber, REGIONS, BRAZILIAN_AIRPORTS };
