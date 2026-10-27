/**
 * Interface canônica e tipos para provedores de conexão bancária (Open Finance, agregadores e fallbacks).
 */

export interface BankAccountRaw {
  idExterno: string;
  nome: string;
  tipo: 'CONTA_CORRENTE' | 'CARTAO_CREDITO' | 'INVESTIMENTO' | 'CARTEIRA_DINHEIRO';
  saldoAtual?: number;
  diaFechamento?: number;
  diaVencimento?: number;
  subtipo?: string;
  numeroConta?: string;
  agencia?: string;
  digitosCartao?: string;
}

export interface BankTransactionRaw {
  idExterno?: string;
  data: string; // YYYY-MM-DD
  descricao: string;
  valor: number; // Sempre positivo ou absoluto
  natureza: 'RECEITA' | 'DESPESA' | 'TRANSFERENCIA_PROPRIA' | 'APORTE_PATRIMONIAL';
  isPagamentoFatura?: boolean;
  categoriaSugerida?: string;
  memo?: string;
  documentoNumero?: string;
}

export interface BankInvoiceRaw {
  idExterno: string;
  cartaoNome: string;
  competencia: string; // YYYY-MM
  dataFechamento: string;
  dataVencimento: string;
  valorTotal: number;
  status: 'ABERTA' | 'FECHADA' | 'PAGA';
  lancamentos: BankTransactionRaw[];
}

export interface BankConsentResult {
  sucesso: boolean;
  consentimentoId: string;
  expiraEm: Date;
  urlAutorizacao?: string;
  detalhes?: Record<string, unknown>;
}

export interface BankSyncResult {
  instituicaoCodigo: string;
  contasSincronizadas: number;
  transacoesDetectadas: number;
  novosMovimentosInseridos: number;
  movimentosIgnoradosDedupe: number;
  erros: string[];
}

export interface IBankConnectorProvider {
  /**
   * Código COMPE ou identificador único do participante Open Finance (ex: "341" para Itaú, "CON-HUB" para Genérico)
   */
  readonly codigo: string;
  readonly nome: string;
  readonly compe?: string;

  /**
   * Autentica ou valida as credenciais/tokens de consentimento
   */
  authenticate(credentials?: Record<string, unknown>): Promise<BankConsentResult>;

  /**
   * Lista as contas e cartões associados ao consentimento ou credencial
   */
  listAccounts(consentimentoId: string): Promise<BankAccountRaw[]>;

  /**
   * Obtém as transações de extrato em um período para determinada conta
   */
  fetchTransactions(params: {
    consentimentoId: string;
    contaIdExterno: string;
    dataInicio: string; // YYYY-MM-DD
    dataFim: string; // YYYY-MM-DD
  }): Promise<BankTransactionRaw[]>;

  /**
   * Obtém as faturas e seus lançamentos detalhados de cartões de crédito
   */
  fetchCreditCardInvoices(params: {
    consentimentoId: string;
    cartaoIdExterno: string;
    competencia?: string; // YYYY-MM
  }): Promise<BankInvoiceRaw[]>;

  /**
   * Revoga ou cancela o consentimento de acesso
   */
  revokeConsent(consentimentoId: string): Promise<boolean>;
}
