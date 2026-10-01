# Painel de Chegadas WFS

Painel operacional de TV para chegadas Narrow Body. O visual permanece em
HTML/CSS/JavaScript e o backend Express é a única camada que consulta o SIGA.

## Fluxo de dados

```text
SIGA + Winglet/Smart Fuel → backend do Painel de Chegadas → GET /api/chegadas/voos → frontend
```

O navegador não conhece `MALHA_BASE_URL`, `SIGA_STREAM_API_KEY`,
`WINGLET_API_KEY`, headers ou payloads brutos. A rota interna retorna somente o
contrato normalizado do painel, com `Cache-Control: no-store`.

## Executar

```powershell
cd back-end
Copy-Item .env.example .env
# Preencha MALHA_BASE_URL e SIGA_STREAM_API_KEY no .env local.
npm install
npm start
```

Abra `http://localhost:3000`. Em caso de indisponibilidade do SIGA, a API retorna
erro estruturado, o frontend mantém a última lista válida e o indicador `AO VIVO`
muda discretamente para `ATUALIZAÇÃO INDISPONÍVEL`.

## Integração SIGA/Malha

Foi reutilizado o client funcional do `WFS-RETIRADAS`:

- endpoint externo: `GET ${MALHA_BASE_URL}/siga-flights/public`;
- autenticação exclusivamente no backend: header `x-api-key` com
  `SIGA_STREAM_API_KEY`;
- timeout específico de até 120 segundos para a carga inicial do snapshot;
- somente HTTP 200 + JSON array é aceito;
- nenhuma falha alterna automaticamente para mock.

O último snapshot válido da Malha é mantido em memória e em
`.runtime-cache/`, que permanece ignorado pelo Git. Depois da primeira
carga, as consultas do painel respondem pelo cache real enquanto a renovação
ocorre em segundo plano. Se a renovação permanecer indisponível, os voos não
são apagados e o cabeçalho `X-Data-Stale` sinaliza que os dados estão antigos.

Mapeamento operacional:

| Painel | SIGA |
|---|---|
| ID operacional | `id` |
| VOO | `number_arrival` |
| ORIGEM | `ori` |
| ETA | `eta_date` + `eta_time` |
| BOX | `park_position_arrival` |
| Calço | `engine_off`, com `arrival_time` como fallback conforme adapter existente da Malha |
| Porta aberta | presença de `pax_door_open` |
| Status técnico | `status_flight_arrival` |

Datas e horários do SIGA são interpretados em `America/Sao_Paulo`. O backend
mantém somente chegadas com ETA válido entre agora e os próximos 60 minutos,
sem calço e sem porta aberta, ordena por ETA e limita em 12.

## Classificação Narrow/Wide

O painel é exclusivo para Narrow Body. A lista oficial de 112 prefixos Wide do
`WFS-RETIRADAS/src/data/classificacaoFrota.ts` foi extraída, sem alteração da
fonte original, para [`back-end/src/domain/wideBodyPrefixes.js`](src/domain/wideBodyPrefixes.js).
O campo `prefix` do SIGA é normalizado (maiúsculas, espaços removidos e hífen
simples recomposto) e o filtro Wide ocorre antes da janela de 60 minutos, da
ordenação e do limite de 12. Prefixos desconhecidos seguem a regra existente
do Retiradas e são tratados como Narrow.

## Outros providers

Hoje **FONIA e SMARTF** sinalizam cores. As demais cadeiras ficam **cinza (sem
sinal)** até a API correspondente entrar — nunca amarelo/vermelho por falta de
integração:

- FONIA: API de escalados do WFS-FONIA (`GET {FONIA_API_URL}?data=YYYY-MM-DD`,
  header `x-api-key` = `INTEGRACAO_API_KEY_CHEGADA`), casada por data + voo da
  chegada (ETA de madrugada também consulta a véspera). Cores: azul = escalado
  (nome da equipe no quadro), verde = na posição, amarelo ≤ 15 min e vermelho
  ≤ 5 min sem escala, cinza fora da janela. Registro `cancelado` é ignorado.
- REST.: cinza, exceto com `REST_PROVIDER=api` e `REST_API_BASE_URL`.
- LIMPEZA, QTU e QTA: cinzas e vazias.
- SMARTF consulta a Winglet pelo backend, cruza somente chegadas da mesma data
  operacional/trecho. Em falha, reaproveita o último estado válido por até
  10 minutos; depois disso a linha fica cinza em vez de alarmar.
- Cada serviço vem no payload com `integrated: true|false`; o frontend pinta de
  cinza tudo que não vier `integrated: true`.
- Voos mockados (e Fonia/REST. fictícias) existem somente com
  `CHEGADAS_USE_MOCK_FLIGHTS=true`. O padrão é sempre SIGA real.
- Chegadas com `status_flight_arrival = C` (canceladas) não aparecem.

## Rotas

| Rota | Uso |
|---|---|
| `GET /api/chegadas/voos` | frontend servido pelo próprio backend |
| `GET /chegadas/voos` | atrás de proxy que remove o prefixo `/api` (nginx) |
| `GET /voos`, `/api/voos` | compatibilidade com instalações antigas |
| `GET /health`, `/api/health` | modo de cada provider |

Requisições simultâneas de várias TVs reaproveitam a mesma montagem por 10 s.
A SIGA é consultada no máximo a cada `MALHA_REFRESH_INTERVAL_MS` (30 s) e o
painel mostra `ATUALIZAÇÃO INDISPONÍVEL` quando o snapshot passa de
`MALHA_STALE_AFTER_MS` (5 min). Um snapshot sem nenhuma chegada reconhecível
não substitui o cache válido.

## Variáveis de ambiente

Consulte [`back-end/.env.example`](.env.example):

- Preencha agora o bloco **Servidor** (`PORT`, `FRONTEND_URL`) e o bloco
  **Voos — FlightRadar / SIGA-Malha** (`MALHA_BASE_URL` e
  `SIGA_STREAM_API_KEY`). `PROVIDER_TIMEOUT_MS` e
  `CHEGADAS_USE_MOCK_FLIGHTS` são controles do backend. `SIGA_TIMEOUT_MS`
  controla separadamente a carga do snapshot volumoso da Malha; o mock só deve
  ser ativado explicitamente em desenvolvimento.
- O bloco **Fonia** não exige configuração nesta etapa: a linha FONIA fica cinza
  até a integração oficial. `FONIA_STREAM_API_KEY` aparece comentada por
  compatibilidade com a convenção do projeto irmão e só deve ser preenchida
  quando o provider oficial for integrado.
- O bloco **REST.** é opcional. Mantenha `REST_PROVIDER=off` enquanto não
  houver endpoint e token (linha cinza); para integrar, altere para `api` e preencha as duas
  variáveis `REST_API_*` no backend.
- O bloco **Winglet / Smart Fuel** usa `WINGLET_API_BASE_URL` e
  `WINGLET_API_KEY`. A chave permanece exclusivamente no backend.
- As variáveis comentadas em **Futuras cadeiras** (`LIMPEZA_*`, `QTU_*`,
  `QTA_*` e os nomes legados `SMARTF_*`) não são consumidas pelo código.

O `.env.example` contém somente placeholders. Chaves e tokens reais devem ficar
exclusivamente no `.env` do backend, nunca em variáveis `VITE_*` ou no frontend.

As antigas variáveis de Google Sheets não são usadas.

## Pendências operacionais

`park_position_arrival` alimenta BOX. `pax_door_open` é usado exclusivamente
como indicador para remover voos com porta aberta. Não há fallback para
`boarding_gate` ou outros campos. O filtro por calço segue ativo. A Fonia ainda
não possui endpoint oficial no workspace, e a REST. fica cinza enquanto
suas variáveis não forem configuradas. No snapshot combinado do SIGA, `des`
pertence à perna de saída seguinte e não é usado como destino da chegada.

## Validação

```powershell
cd back-end
npm test
npm run build
```

Os testes cobrem client/headers SIGA, adapter dos campos reais, fuso, janela de
60 minutos, limite de 12, ordenação, calço, porta aberta, erros sanitizados e o
modo mock estritamente explícito.
