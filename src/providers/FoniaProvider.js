'use strict';

/**
 * Fronteira da Fonia.
 *
 * O projeto WFS-FONIA encontrado no workspace ainda usa mocks/localStorage e
 * sua documentação proíbe inventar endpoints. Por isso este provider mantém o
 * contrato isolado, mas declara-se indisponível até existir uma API oficial.
 * Enquanto isConfigured() for false, o painel exibe a linha FONIA em cinza.
 */
class FoniaProvider {
  isConfigured() {
    return false;
  }

  async getAssignments() {
    throw new Error('API da Fonia ainda não possui endpoint oficial');
  }
}

module.exports = { FoniaProvider };
