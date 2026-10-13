import {
  BankAccountRaw,
  BankTransactionRaw,
  BankInvoiceRaw,
  BankConsentResult,
} from '../types/bank-connector.interface.js';
import { env } from '../../../config/env.js';

export interface OpenFinanceApiClientConfig {
  baseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  timeoutMs?: number;
}

export interface OpenFinanceAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * Cliente HTTP resiliente para integração com APIs reais do ecossistema Open Finance Brasil
 * e agregadores bancários homologados (Pluggy, Belvo, Guiabolso/BTG, APIs Diretas dos Bancos).
 */
export class OpenFinanceApiClient {
  private baseUrl: string;
  private clientId?: string;
  private clientSecret?: string;
  private timeoutMs: number;

  constructor(config?: OpenFinanceApiClientConfig) {
    this.baseUrl =
      config?.baseUrl ||
      env.OPEN_FINANCE_API_URL ||
      'https://api.openfinance.brasil.gov.br/open-banking/v1';
    this.clientId = config?.clientId || env.OPEN_FINANCE_CLIENT_ID;
    this.clientSecret = config?.clientSecret || env.OPEN_FINANCE_CLIENT_SECRET;
    this.timeoutMs = config?.timeoutMs || 10000;
  }

  /**
   * Obtém token de autenticação mTLS / OAuth2 client_credentials
   */
  public async getAccessToken(customCredentials?: {
    clientId?: string;
    clientSecret?: string;
  }): Promise<OpenFinanceAuthTokenResponse> {
    const cId = customCredentials?.clientId || this.clientId;
    const cSecret = customCredentials?.clientSecret || this.clientSecret;

    if (!cId || !cSecret) {
      throw new Error(
        'Credenciais de cliente Open Finance (clientId e clientSecret) não configuradas para o modo real.'
      );
    }

    const tokenUrl = `${this.baseUrl.replace(/\/$/, '')}/oauth/token`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const basicAuth = Buffer.from(`${cId}:${cSecret}`).toString('base64');
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basicAuth}`,
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          scope: 'accounts credit-cards-accounts transactions',
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Erro HTTP ${response.status} ao obter token Open Finance: ${errorText || response.statusText}`
        );
      }

      return (await response.json()) as OpenFinanceAuthTokenResponse;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Timeout de conexão (${this.timeoutMs}ms) com o servidor Open Finance [${tokenUrl}].`);
      }
      throw err;
    }
  }

  /**
   * Consulta lista de contas vinculadas ao consentimento na API Real
   */
  public async fetchAccounts(
    consentimentoId: string,
    tokenAcesso?: string
  ): Promise<BankAccountRaw[]> {
    const endpoint = `${this.baseUrl.replace(/\/$/, '')}/consents/${encodeURIComponent(consentimentoId)}/accounts`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (tokenAcesso) {
      headers['Authorization'] = `Bearer ${tokenAcesso}`;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(endpoint, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const erroMsg = await response.text();
        throw new Error(
          `Falha ao buscar contas reais na API Open Finance (${response.status}): ${erroMsg || response.statusText}`
        );
      }

      const data = (await response.json()) as any;
      const rawAccountsList: any[] = Array.isArray(data) ? data : data.data || data.accounts || [];

      return rawAccountsList.map((item) => ({
        idExterno: item.id || item.accountId || item.idExterno,
        nome: item.name || item.brandName || item.nome || 'Conta Bancária Santander',
        tipo:
          item.type === 'CREDIT_CARD' || item.tipo === 'CARTAO_CREDITO'
            ? 'CARTAO_CREDITO'
            : 'CONTA_CORRENTE',
        saldoAtual: typeof item.balance === 'number' ? item.balance : item.saldoAtual ?? 0,
        diaFechamento: item.closingDay || item.diaFechamento,
        diaVencimento: item.dueDay || item.diaVencimento,
        subtipo: item.subtype || item.subtipo,
      }));
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Timeout ao consultar contas no endpoint Open Finance [${endpoint}].`);
      }
      throw err;
    }
  }

  /**
   * Consulta transações de extrato bancário na API Real
   */
  public async fetchTransactions(params: {
    consentimentoId: string;
    contaIdExterno: string;
    dataInicio: string;
    dataFim: string;
    tokenAcesso?: string;
  }): Promise<BankTransactionRaw[]> {
    const { consentimentoId, contaIdExterno, dataInicio, dataFim, tokenAcesso } = params;
    const url = new URL(
      `${this.baseUrl.replace(/\/$/, '')}/consents/${encodeURIComponent(consentimentoId)}/accounts/${encodeURIComponent(contaIdExterno)}/transactions`
    );
    url.searchParams.set('from', dataInicio);
    url.searchParams.set('to', dataFim);

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (tokenAcesso) {
      headers['Authorization'] = `Bearer ${tokenAcesso}`;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const erroMsg = await response.text();
        throw new Error(
          `Falha ao buscar transações reais na API Open Finance (${response.status}): ${erroMsg || response.statusText}`
        );
      }

      const data = (await response.json()) as any;
      const txList: any[] = Array.isArray(data) ? data : data.data || data.transactions || [];

      return txList.map((tx) => ({
        idExterno: tx.id || tx.transactionId || tx.idExterno,
        data: (tx.date || tx.bookingDate || tx.data || dataInicio).split('T')[0],
        descricao: tx.description || tx.descricao || 'Transação Bancária',
        valor: Math.abs(Number(tx.amount || tx.valor || 0)),
        natureza:
          tx.natureza ||
          (tx.type === 'DEBIT' || tx.type === 'DEBITO'
            ? 'DESPESA'
            : tx.type === 'CREDIT' || tx.type === 'CREDITO'
              ? 'RECEITA'
              : (tx.amount && Number(tx.amount) < 0)
                ? 'DESPESA'
                : 'RECEITA'),
        memo: tx.memo || tx.category || undefined,
        documentoNumero: tx.documentNumber || tx.documentoNumero || undefined,
      }));
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Timeout ao consultar transações reais no endpoint Open Finance [${url}].`);
      }
      throw err;
    }
  }

  /**
   * Consulta faturas de cartão de crédito na API Real
   */
  public async fetchCreditCardInvoices(params: {
    consentimentoId: string;
    cartaoIdExterno: string;
    competencia?: string;
    tokenAcesso?: string;
  }): Promise<BankInvoiceRaw[]> {
    const { consentimentoId, cartaoIdExterno, competencia, tokenAcesso } = params;
    const url = new URL(
      `${this.baseUrl.replace(/\/$/, '')}/consents/${encodeURIComponent(consentimentoId)}/credit-cards/${encodeURIComponent(cartaoIdExterno)}/bills`
    );
    if (competencia) {
      url.searchParams.set('competencia', competencia);
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (tokenAcesso) {
      headers['Authorization'] = `Bearer ${tokenAcesso}`;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const erroMsg = await response.text();
        throw new Error(
          `Falha ao buscar faturas de cartão na API Open Finance (${response.status}): ${erroMsg || response.statusText}`
        );
      }

      const data = (await response.json()) as any;
      const invoiceList: any[] = Array.isArray(data) ? data : data.data || data.bills || [];

      return invoiceList.map((inv) => ({
        idExterno: inv.id || inv.billId || inv.idExterno,
        cartaoNome: inv.cardName || inv.cartaoNome || 'Cartão de Crédito',
        competencia: inv.competencia || competencia || new Date().toISOString().substring(0, 7),
        dataFechamento: inv.closingDate || inv.dataFechamento,
        dataVencimento: inv.dueDate || inv.dataVencimento,
        valorTotal: Math.abs(Number(inv.totalAmount || inv.valorTotal || 0)),
        status: inv.status || 'FECHADA',
        lancamentos: (inv.items || inv.lancamentos || []).map((item: any) => ({
          idExterno: item.id || item.transactionId || item.idExterno,
          data: (item.date || item.data || inv.dueDate).split('T')[0],
          descricao: item.description || item.descricao || 'Item de Fatura',
          valor: Math.abs(Number(item.amount || item.valor || 0)),
          natureza: 'DESPESA',
          categoriaSugerida: item.category || item.categoriaSugerida,
          memo: item.memo,
        })),
      }));
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Timeout ao consultar faturas reais no endpoint Open Finance [${url}].`);
      }
      throw err;
    }
  }

  /**
   * Revoga consentimento na API Real
   */
  public async revokeConsent(consentimentoId: string, tokenAcesso?: string): Promise<boolean> {
    const endpoint = `${this.baseUrl.replace(/\/$/, '')}/consents/${encodeURIComponent(consentimentoId)}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (tokenAcesso) {
      headers['Authorization'] = `Bearer ${tokenAcesso}`;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(endpoint, {
        method: 'DELETE',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timer);
      return response.ok;
    } catch {
      return false;
    }
  }
}
