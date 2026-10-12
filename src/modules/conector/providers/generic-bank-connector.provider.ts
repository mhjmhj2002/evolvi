import {
  IBankConnectorProvider,
  BankConsentResult,
  BankAccountRaw,
  BankTransactionRaw,
  BankInvoiceRaw,
} from '../types/bank-connector.interface.js';

/**
 * Conector padrão e de simulação/homologação para testes do Hub Open Finance
 * e bancos genéricos com suporte a dados mockados determinísticos.
 */
export class GenericBankConnectorProvider implements IBankConnectorProvider {
  public readonly codigo: string;
  public readonly nome: string;
  public readonly compe?: string;

  constructor(codigo: string = 'CON-HUB', nome: string = 'Hub Open Finance Brasil', compe?: string) {
    this.codigo = codigo;
    this.nome = nome;
    this.compe = compe;
  }

  async authenticate(credentials?: Record<string, unknown>): Promise<BankConsentResult> {
    const consentId = `consent_${this.codigo.toLowerCase()}_${Date.now()}`;
    const expiraEm = new Date();
    expiraEm.setDate(expiraEm.getDate() + 90); // 90 dias padrão Open Finance

    return {
      sucesso: true,
      consentimentoId: consentId,
      expiraEm,
      urlAutorizacao: `https://auth.openfinance.org.br/consent/${consentId}`,
      detalhes: credentials,
    };
  }

  async listAccounts(consentimentoId: string): Promise<BankAccountRaw[]> {
    return [
      {
        idExterno: `acc_${this.codigo}_01`,
        nome: `${this.nome} Conta Corrente`,
        tipo: 'CONTA_CORRENTE',
        saldoAtual: 3500.0,
      },
      {
        idExterno: `card_${this.codigo}_01`,
        nome: `${this.nome} Cartão Crédito`,
        tipo: 'CARTAO_CREDITO',
        diaFechamento: 25,
        diaVencimento: 5,
      },
    ];
  }

  async fetchTransactions(params: {
    consentimentoId: string;
    contaIdExterno: string;
    dataInicio: string;
    dataFim: string;
  }): Promise<BankTransactionRaw[]> {
    // Retorna lançamentos de exemplo formatados
    return [
      {
        idExterno: `tx_${params.contaIdExterno}_01`,
        data: params.dataInicio,
        descricao: 'PIX Recebido Transferência',
        valor: 1500.0,
        natureza: 'RECEITA',
      },
      {
        idExterno: `tx_${params.contaIdExterno}_02`,
        data: params.dataInicio,
        descricao: 'Compra Supermercado Modelo',
        valor: 245.5,
        natureza: 'DESPESA',
      },
      {
        idExterno: `tx_${params.contaIdExterno}_03`,
        data: params.dataInicio,
        descricao: 'Pagamento Fatura Cartão de Crédito',
        valor: 1200.0,
        natureza: 'TRANSFERENCIA_PROPRIA',
        isPagamentoFatura: true,
      },
    ];
  }

  async fetchCreditCardInvoices(params: {
    consentimentoId: string;
    cartaoIdExterno: string;
    competencia?: string;
  }): Promise<BankInvoiceRaw[]> {
    const comp = params.competencia || '2026-10';
    return [
      {
        idExterno: `inv_${params.cartaoIdExterno}_${comp}`,
        cartaoNome: `${this.nome} Cartão`,
        competencia: comp,
        dataFechamento: `${comp}-25`,
        dataVencimento: `${comp}-05`,
        valorTotal: 1200.0,
        status: 'FECHADA',
        lancamentos: [
          {
            idExterno: `inv_item_01`,
            data: `${comp}-10`,
            descricao: 'Restaurante Central',
            valor: 85.0,
            natureza: 'DESPESA',
          },
          {
            idExterno: `inv_item_02`,
            data: `${comp}-15`,
            descricao: 'Combustível Posto',
            valor: 215.0,
            natureza: 'DESPESA',
          },
        ],
      },
    ];
  }

  async revokeConsent(consentimentoId: string): Promise<boolean> {
    return true;
  }
}
