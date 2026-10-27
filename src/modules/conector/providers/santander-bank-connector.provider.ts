import {
  IBankConnectorProvider,
  BankConsentResult,
  BankAccountRaw,
  BankTransactionRaw,
  BankInvoiceRaw,
} from '../types/bank-connector.interface.js';
import { env } from '../../../config/env.js';
import { OpenFinanceApiClient } from '../client/open-finance-api.client.js';

export interface SantanderCredentials {
  clientId?: string;
  clientSecret?: string;
  agencia?: string;
  conta?: string;
  tokenAcesso?: string;
}

/**
 * Conector Bancário Especializado para o Banco Santander Brasil (COMPE 033).
 * Implementa suporte dual (Alternância de Modo Mock vs Real via OPEN_FINANCE_MODE):
 * - Modo Mock (padrão / sandbox): Mocks ricos para suíte de testes de regressão e simulação rápida
 * - Modo Real (OPEN_FINANCE_MODE=real): Integração HTTP resiliente com APIs do Open Finance Brasil
 * Mantém normalização de extratos Santander, anti-dupla contagem de faturas e mapeamento POF.
 */
export class SantanderBankConnectorProvider implements IBankConnectorProvider {
  public readonly codigo: string = '033';
  public readonly nome: string = 'Santander';
  public readonly compe: string = '033';

  private apiClient: OpenFinanceApiClient;

  constructor(client?: OpenFinanceApiClient) {
    this.apiClient = client || new OpenFinanceApiClient();
  }

  /**
   * Indica se o conector está operando em modo real ou em modo mock/simulação
   */
  public get modoOperacao(): 'mock' | 'real' {
    return env.OPEN_FINANCE_MODE === 'real' ? 'real' : 'mock';
  }

  /**
   * Dicionário de classificação e categorização heurística para extratos Santander.
   * Mapeia padrões de histórico/descrição para categorias POF estruturadas.
   */
  public static classificarTransacaoSantander(descricao: string): {
    categoriaSugerida: string;
    natureza: BankTransactionRaw['natureza'];
    isPagamentoFatura?: boolean;
  } {
    const desc = (descricao || '').trim();
    const dUpper = desc.toUpperCase();

    // 1. Anti-Dupla Contagem: Pagamentos de fatura de cartão Santander debitadas em conta corrente
    if (
      /pag(amento|to)?\s*(efetuado|de\s*fat(ura)?|da\s*fat(ura)?|fatura|recebido)|santander\s*way|way\s*cart[aã]o|fatura\s*cart[aã]o|deb\s*aut\s*cartao\s*santander|pagto\s*tit\s*bco\s*santander|debito\s*automatico\s*fatura|pag\s*fatura/i.test(
        desc
      )
    ) {
      return {
        categoriaSugerida: 'Outras Despesas Correntes',
        natureza: 'TRANSFERENCIA_PROPRIA',
        isPagamentoFatura: true,
      };
    }

    // 2. Receitas operacionais e proventos
    if (/TED\s*RECEBIDA|PIX\s*RECEBIDO|CRED\s*SALARIO|CRED\s*TED|RENDIMENTO\s*POUPANCA|PROVENTOS/i.test(desc)) {
      return {
        categoriaSugerida: 'Rendimento do Trabalho',
        natureza: 'RECEITA',
      };
    }

    // 3. Habitação e Moradia
    if (/ENEL|SABESP|COPASA|COMGAS|CPFL|CONDOMINIO|ALUGUEL|LIGHT|ENERGISA|SANEPAR/i.test(dUpper)) {
      return {
        categoriaSugerida: 'Habitação',
        natureza: 'DESPESA',
      };
    }

    // 4. Alimentação
    if (
      /SUPERMERCADO|MERCADO|PAO\s*DE\s*ACUCAR|CARREFOUR|ASSAI|ATACADAO|IFOOD|RESTAURANTE|PADARIA|HORTIFRUTI|ZONA\s*SUL/i.test(
        dUpper
      )
    ) {
      return {
        categoriaSugerida: 'Alimentação',
        natureza: 'DESPESA',
      };
    }

    // 5. Transporte
    if (/POSTO|COMBUSTIVEL|SHELL|IPIRANGA|BR\s*PETROBRAS|UBER|99APP|ESTAPAR|SEM\s*PARAR|VELOE/i.test(dUpper)) {
      return {
        categoriaSugerida: 'Transporte',
        natureza: 'DESPESA',
      };
    }

    // 6. Saúde e Cuidados Pessoais
    if (/FARMACIA|DROGASIL|DROGA\s*RAIA|PAGUE\s*MENOS|SAO\s*PAULO\s*DROG|CONSULTA|LABORATORIO|HOSPITAL/i.test(dUpper)) {
      return {
        categoriaSugerida: 'Saúde e Cuidados Pessoais',
        natureza: 'DESPESA',
      };
    }

    // 7. Serviços Financeiros e Tarifas Bancárias Santander
    if (/TAR\s*MENSALIDADE|TARIFA\s*CONTA|TARIFA\s*TED|TARIFA\s*PIX|PACOTE\s*SERVICOS|IOF|ENCARGOS\s*CONTA|ANUIDADE/i.test(dUpper)) {
      return {
        categoriaSugerida: 'Serviços Bancários e Financeiros',
        natureza: 'DESPESA',
      };
    }

    // 8. Educação
    if (/FACULDADE|UNIVERSIDADE|ESCOLA|COL[EÉ]GIO|CURSO|UDEMY|ALURA|CNA|WIZARD/i.test(dUpper)) {
      return {
        categoriaSugerida: 'Educação',
        natureza: 'DESPESA',
      };
    }

    // Padrão Geral
    return {
      categoriaSugerida: 'Outras Despesas Correntes',
      natureza: 'DESPESA',
    };
  }

  /**
   * Autentica ou estabelece sessão Open Finance para o Santander Brasil
   */
  async authenticate(credentials?: Record<string, unknown>): Promise<BankConsentResult> {
    const creds = (credentials || {}) as SantanderCredentials;
    const isModoReal = this.modoOperacao === 'real';

    if (isModoReal && (creds.clientId || env.OPEN_FINANCE_CLIENT_ID)) {
      try {
        const tokenResp = await this.apiClient.getAccessToken({
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
        });

        const consentId = `santander_live_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const expiraEm = new Date();
        expiraEm.setDate(expiraEm.getDate() + 90);

        return {
          sucesso: true,
          consentimentoId: consentId,
          expiraEm,
          urlAutorizacao: `https://auth.santander.com.br/open-banking/v1/auth?consent_id=${consentId}`,
          detalhes: {
            banco: 'Banco Santander Brasil S.A.',
            compe: '033',
            ambiente: 'OPEN_FINANCE_LIVE',
            tokenAcesso: tokenResp.access_token,
            agenciaMascarada: creds.agencia ? `${creds.agencia.substring(0, 2)}**` : '****',
          },
        };
      } catch (err: unknown) {
        // Fallback defensivo ou erro explicativo
        console.warn('[SantanderBankConnector] Erro ao autenticar no modo real, verificando fallback:', err);
        throw new Error(
          `Falha na autenticação com a API Real do Santander: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Modo Mock / Sandbox
    const consentId = `santander_consent_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const expiraEm = new Date();
    expiraEm.setDate(expiraEm.getDate() + 90); // 90 dias padrão Banco Central / Open Finance

    return {
      sucesso: true,
      consentimentoId: consentId,
      expiraEm,
      urlAutorizacao: `https://auth.santander.com.br/open-banking/v1/auth?consent_id=${consentId}`,
      detalhes: {
        banco: 'Banco Santander Brasil S.A.',
        compe: '033',
        ambiente: creds.clientId ? 'API_PRODUCAO' : 'SIMULACAO_SANDBOX',
        agenciaMascarada: creds.agencia ? `${creds.agencia.substring(0, 2)}**` : '****',
      },
    };
  }

  /**
   * Lista as contas e cartões Santander vinculados ao consentimento
   */
  async listAccounts(consentimentoId: string): Promise<BankAccountRaw[]> {
    if (this.modoOperacao === 'real') {
      try {
        const contasReais = await this.apiClient.fetchAccounts(consentimentoId);
        if (contasReais && contasReais.length > 0) {
          return contasReais;
        }
      } catch (err: unknown) {
        console.warn(`[SantanderBankConnector] Falha na consulta de contas reais Open Finance:`, err);
        throw new Error(
          `Não foi possível obter contas reais do Santander: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Retorno do Modo Mock para testes e demonstrações
    return [
      {
        idExterno: 'santander_cc_2041_88765',
        nome: 'Santander Conta Corrente Ag 2041',
        tipo: 'CONTA_CORRENTE',
        saldoAtual: 3120.45,
        subtipo: 'CONTA_CORRENTE_INDIVIDUAL',
      },
      {
        idExterno: 'santander_card_sx_visa_3210',
        nome: 'Santander SX Visa Final 3210',
        tipo: 'CARTAO_CREDITO',
        diaFechamento: 20,
        diaVencimento: 28,
        subtipo: 'CARTAO_CREDITO_INTERNACIONAL',
      },
    ];
  }

  /**
   * Obtém as transações de extrato bancário do Santander
   */
  async fetchTransactions(params: {
    consentimentoId: string;
    contaIdExterno: string;
    dataInicio: string;
    dataFim: string;
  }): Promise<BankTransactionRaw[]> {
    if (this.modoOperacao === 'real') {
      try {
        const transacoesReais = await this.apiClient.fetchTransactions({
          consentimentoId: params.consentimentoId,
          contaIdExterno: params.contaIdExterno,
          dataInicio: params.dataInicio,
          dataFim: params.dataFim,
        });

        // Enriquecer com classificação POF e regra anti-dupla contagem
        return transacoesReais.map((tx) => {
          const classif = SantanderBankConnectorProvider.classificarTransacaoSantander(tx.descricao);
          return {
            ...tx,
            natureza: classif.natureza,
            isPagamentoFatura: classif.isPagamentoFatura || tx.isPagamentoFatura,
            categoriaSugerida: tx.categoriaSugerida || classif.categoriaSugerida,
          };
        });
      } catch (err: unknown) {
        console.warn(`[SantanderBankConnector] Falha ao consultar transações reais Open Finance:`, err);
        throw new Error(
          `Não foi possível obter extrato real do Santander: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const dt = params.dataInicio;
    const isCartao = params.contaIdExterno.includes('card');

    if (isCartao) {
      // Extrato direto de compras no cartão Santander
      return [
        {
          idExterno: `${params.contaIdExterno}_tx_01`,
          data: dt,
          descricao: 'CARREFOUR HIPERMERCADO',
          valor: 315.6,
          natureza: 'DESPESA',
          categoriaSugerida: 'Alimentação',
        },
        {
          idExterno: `${params.contaIdExterno}_tx_02`,
          data: dt,
          descricao: 'UBER TRIP BRASIL',
          valor: 42.8,
          natureza: 'DESPESA',
          categoriaSugerida: 'Transporte',
        },
      ];
    }

    // Transações típicas de conta corrente Santander
    const transacoesExemplo = [
      {
        id: `${params.contaIdExterno}_salario`,
        desc: 'CRED SALARIO EMPRESA S.A.',
        valor: 6200.0,
      },
      {
        id: `${params.contaIdExterno}_tarifa`,
        desc: 'TAR MENSALIDADE PACOTE SANTANDER',
        valor: 39.9,
      },
      {
        id: `${params.contaIdExterno}_pix_mercado`,
        desc: 'PIX ENVIADO MERCADO MUNICIPAL',
        valor: 185.3,
      },
      {
        id: `${params.contaIdExterno}_posto`,
        desc: 'POSTO BR PETROBRAS COMBUSTIVEL',
        valor: 210.0,
      },
      {
        id: `${params.contaIdExterno}_deb_fatura`,
        desc: 'DEB AUT CARTAO SANTANDER WAY',
        valor: 1420.0,
      },
    ];

    return transacoesExemplo.map((t) => {
      const classif = SantanderBankConnectorProvider.classificarTransacaoSantander(t.desc);
      return {
        idExterno: t.id,
        data: dt,
        descricao: t.desc,
        valor: t.valor,
        natureza: classif.natureza,
        isPagamentoFatura: classif.isPagamentoFatura,
        categoriaSugerida: classif.categoriaSugerida,
        memo: `Extrato Santander 033 - ${t.desc}`,
      };
    });
  }

  /**
   * Obtém faturas e lançamentos detalhados de cartões Santander Way / SX
   */
  async fetchCreditCardInvoices(params: {
    consentimentoId: string;
    cartaoIdExterno: string;
    competencia?: string;
  }): Promise<BankInvoiceRaw[]> {
    if (this.modoOperacao === 'real') {
      try {
        const faturasReais = await this.apiClient.fetchCreditCardInvoices({
          consentimentoId: params.consentimentoId,
          cartaoIdExterno: params.cartaoIdExterno,
          competencia: params.competencia,
        });

        // Enriquecer itens com classificação POF e regra anti-dupla contagem
        return faturasReais.map((fat) => ({
          ...fat,
          lancamentos: fat.lancamentos.map((l) => {
            const classif = SantanderBankConnectorProvider.classificarTransacaoSantander(l.descricao);
            return {
              ...l,
              natureza: classif.natureza,
              isPagamentoFatura: classif.isPagamentoFatura,
              categoriaSugerida: l.categoriaSugerida || classif.categoriaSugerida,
            };
          }),
        }));
      } catch (err: unknown) {
        console.warn(`[SantanderBankConnector] Falha ao consultar faturas reais Open Finance:`, err);
        throw new Error(
          `Não foi possível obter faturas reais do cartão Santander: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const comp = params.competencia || '2026-10';

    const lancamentosSantander: Array<{ id: string; desc: string; valor: number; dia: string }> = [
      { id: 'santander_item_01', desc: 'RESTAURANTE MAMA MIA', valor: 165.0, dia: '05' },
      { id: 'santander_item_02', desc: 'POSTO IPIRANGA COMBUSTIVEL', valor: 195.0, dia: '10' },
      { id: 'santander_item_03', desc: 'DROGA RAIA FARMACIA', valor: 78.4, dia: '14' },
      { id: 'santander_item_04', desc: 'IFOOD REFEICOES', valor: 86.5, dia: '18' },
    ];

    const lancamentosFormatados: BankTransactionRaw[] = lancamentosSantander.map((l) => {
      const classif = SantanderBankConnectorProvider.classificarTransacaoSantander(l.desc);
      return {
        idExterno: `${params.cartaoIdExterno}_${comp}_${l.id}`,
        data: `${comp}-${l.dia}`,
        descricao: l.desc,
        valor: l.valor,
        natureza: classif.natureza,
        isPagamentoFatura: classif.isPagamentoFatura,
        categoriaSugerida: classif.categoriaSugerida,
        memo: `Santander SX Fatura ${comp}`,
      };
    });

    const valorTotal = lancamentosFormatados.reduce((acc, cur) => acc + cur.valor, 0);

    return [
      {
        idExterno: `fat_santander_${params.cartaoIdExterno}_${comp}`,
        cartaoNome: 'Santander SX Visa Final 3210',
        competencia: comp,
        dataFechamento: `${comp}-20`,
        dataVencimento: `${comp}-28`,
        valorTotal,
        status: 'FECHADA',
        lancamentos: lancamentosFormatados,
      },
    ];
  }

  /**
   * Revoga consentimento de acesso no Santander
   */
  async revokeConsent(consentimentoId: string): Promise<boolean> {
    if (this.modoOperacao === 'real') {
      try {
        await this.apiClient.revokeConsent(consentimentoId);
      } catch (err) {
        console.warn(`[SantanderBankConnector] Aviso ao revogar consentimento real:`, err);
      }
    }
    return true;
  }
}
