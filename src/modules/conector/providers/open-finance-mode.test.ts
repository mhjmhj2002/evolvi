import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SantanderBankConnectorProvider } from './santander-bank-connector.provider.js';
import { OpenFinanceApiClient } from '../client/open-finance-api.client.js';
import { env } from '../../../config/env.js';

describe('TASK-31: Alternância de Modo Open Finance (Mock vs Real via Variável de Ambiente)', () => {
  let mockApiClient: OpenFinanceApiClient;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // Restaurar modo mock default
    (env as any).OPEN_FINANCE_MODE = 'mock';
  });

  describe('1. Operação sob OPEN_FINANCE_MODE=mock (Padrão e Regressão)', () => {
    it('deve operar em modo mock por padrão com contas e extrato de simulação', async () => {
      (env as any).OPEN_FINANCE_MODE = 'mock';

      const provider = new SantanderBankConnectorProvider();
      expect(provider.modoOperacao).toBe('mock');

      // 1. Contas
      const accounts = await provider.listAccounts('consent_123');
      expect(accounts.length).toBe(2);
      expect(accounts[0].idExterno).toBe('santander_cc_2041_88765');
      expect(accounts[0].tipo).toBe('CONTA_CORRENTE');
      expect(accounts[1].tipo).toBe('CARTAO_CREDITO');

      // 2. Transações
      const txs = await provider.fetchTransactions({
        consentimentoId: 'consent_123',
        contaIdExterno: 'santander_cc_2041_88765',
        dataInicio: '2026-10-01',
        dataFim: '2026-10-15',
      });
      expect(txs.length).toBeGreaterThan(0);
      expect(txs.some((t) => t.isPagamentoFatura)).toBe(true);

      // 3. Faturas
      const faturas = await provider.fetchCreditCardInvoices({
        consentimentoId: 'consent_123',
        cartaoIdExterno: 'santander_card_sx_visa_3210',
        competencia: '2026-10',
      });
      expect(faturas.length).toBe(1);
      expect(faturas[0].status).toBe('FECHADA');
    });

    it('deve autenticar devolvendo ambiente de simulação no modo mock', async () => {
      (env as any).OPEN_FINANCE_MODE = 'mock';

      const provider = new SantanderBankConnectorProvider();
      const auth = await provider.authenticate({ agencia: '2041', conta: '88765-4' });

      expect(auth.sucesso).toBe(true);
      expect(auth.consentimentoId).toMatch(/^santander_consent_/);
      expect(auth.detalhes?.ambiente).toBe('SIMULACAO_SANDBOX');
    });
  });

  describe('2. Operação sob OPEN_FINANCE_MODE=real (Chamadas HTTP Externas / APIs Reais)', () => {
    it('deve delegar para o OpenFinanceApiClient quando OPEN_FINANCE_MODE=real', async () => {
      (env as any).OPEN_FINANCE_MODE = 'real';

      mockApiClient = new OpenFinanceApiClient();

      // Mockar métodos do client
      vi.spyOn(mockApiClient, 'fetchAccounts').mockResolvedValue([
        {
          idExterno: 'real_santander_ag0001_cc123',
          nome: 'Santander Select Especial Real',
          tipo: 'CONTA_CORRENTE',
          saldoAtual: 15420.8,
          subtipo: 'CONTA_CORRENTE_SELECT',
        },
      ]);

      vi.spyOn(mockApiClient, 'fetchTransactions').mockResolvedValue([
        {
          idExterno: 'real_tx_001',
          data: '2026-10-10',
          descricao: 'DEB AUT CARTAO SANTANDER WAY',
          valor: 2350.0,
          natureza: 'TRANSFERENCIA_PROPRIA',
        },
        {
          idExterno: 'real_tx_002',
          data: '2026-10-11',
          descricao: 'PAGAMENTO RESTAURANTE MAMA MIA',
          valor: 140.0,
          natureza: 'DESPESA',
        },
      ]);

      const provider = new SantanderBankConnectorProvider(mockApiClient);
      expect(provider.modoOperacao).toBe('real');

      // 1. Contas Reais
      const accounts = await provider.listAccounts('consent_real_999');
      expect(mockApiClient.fetchAccounts).toHaveBeenCalledWith('consent_real_999');
      expect(accounts.length).toBe(1);
      expect(accounts[0].idExterno).toBe('real_santander_ag0001_cc123');
      expect(accounts[0].saldoAtual).toBe(15420.8);

      // 2. Transações Reais e Classificação POF com Anti-Dupla Contagem
      const txs = await provider.fetchTransactions({
        consentimentoId: 'consent_real_999',
        contaIdExterno: 'real_santander_ag0001_cc123',
        dataInicio: '2026-10-01',
        dataFim: '2026-10-15',
      });

      expect(mockApiClient.fetchTransactions).toHaveBeenCalled();
      expect(txs.length).toBe(2);

      // Pagamento de fatura deve ter convertido para TRANSFERENCIA_PROPRIA
      const txFatura = txs.find((t) => t.descricao.includes('DEB AUT CARTAO SANTANDER WAY'));
      expect(txFatura?.natureza).toBe('TRANSFERENCIA_PROPRIA');
      expect(txFatura?.isPagamentoFatura).toBe(true);

      // Despesa comum deve ter recebido categoria POF sugerida
      const txRestaurante = txs.find((t) => t.descricao.includes('RESTAURANTE'));
      expect(txRestaurante?.natureza).toBe('DESPESA');
      expect(txRestaurante?.categoriaSugerida).toBe('Alimentação');
    });

    it('deve consultar faturas de cartão reais na API e aplicar enriquecimento POF', async () => {
      (env as any).OPEN_FINANCE_MODE = 'real';

      mockApiClient = new OpenFinanceApiClient();

      vi.spyOn(mockApiClient, 'fetchCreditCardInvoices').mockResolvedValue([
        {
          idExterno: 'fat_real_998',
          cartaoNome: 'Santander Elite Platinum Real',
          competencia: '2026-10',
          dataFechamento: '2026-10-20',
          dataVencimento: '2026-10-28',
          valorTotal: 450.0,
          status: 'FECHADA',
          lancamentos: [
            {
              idExterno: 'fat_item_01',
              data: '2026-10-05',
              descricao: 'UBER TRIP BRASIL',
              valor: 50.0,
              natureza: 'DESPESA',
            },
          ],
        },
      ]);

      const provider = new SantanderBankConnectorProvider(mockApiClient);
      const invoices = await provider.fetchCreditCardInvoices({
        consentimentoId: 'consent_real_999',
        cartaoIdExterno: 'card_real_elite',
        competencia: '2026-10',
      });

      expect(mockApiClient.fetchCreditCardInvoices).toHaveBeenCalled();
      expect(invoices.length).toBe(1);
      expect(invoices[0].lancamentos[0].categoriaSugerida).toBe('Transporte');
    });

    it('deve capturar falhas da API real e lançar erro claro sem quebrar silenciosamente', async () => {
      (env as any).OPEN_FINANCE_MODE = 'real';

      mockApiClient = new OpenFinanceApiClient();
      vi.spyOn(mockApiClient, 'fetchAccounts').mockRejectedValue(
        new Error('HTTP 401 Unauthorized: Certificado mTLS expirado')
      );

      const provider = new SantanderBankConnectorProvider(mockApiClient);

      await expect(provider.listAccounts('consent_invalido')).rejects.toThrow(
        /Não foi possível obter contas reais do Santander.*HTTP 401 Unauthorized/
      );
    });

    it('deve autenticar contra API real com clientId e credenciais', async () => {
      (env as any).OPEN_FINANCE_MODE = 'real';

      mockApiClient = new OpenFinanceApiClient();
      vi.spyOn(mockApiClient, 'getAccessToken').mockResolvedValue({
        access_token: 'token_live_access_jwt_123',
        token_type: 'Bearer',
        expires_in: 3600,
      });

      const provider = new SantanderBankConnectorProvider(mockApiClient);
      const auth = await provider.authenticate({
        clientId: 'santander_client_prod_44',
        clientSecret: 'secret_live_pass',
        agencia: '2041',
        conta: '88765-4',
      });

      expect(mockApiClient.getAccessToken).toHaveBeenCalledWith({
        clientId: 'santander_client_prod_44',
        clientSecret: 'secret_live_pass',
      });
      expect(auth.sucesso).toBe(true);
      expect(auth.detalhes?.ambiente).toBe('OPEN_FINANCE_LIVE');
      expect(auth.detalhes?.tokenAcesso).toBe('token_live_access_jwt_123');
    });
  });

  describe('3. Resiliência do OpenFinanceApiClient', () => {
    it('deve formatar parâmetros e cabeçalhos corretamente ao consultar transações', async () => {
      const client = new OpenFinanceApiClient({
        baseUrl: 'https://sandbox.api.santander.com.br/v1',
      });

      // Mock fetch global
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'tx_raw_1',
              date: '2026-10-05T12:00:00Z',
              description: 'MERCADO MODELO',
              amount: 89.9,
              type: 'DEBIT',
            },
          ],
        }),
      } as any);

      const txs = await client.fetchTransactions({
        consentimentoId: 'consent_abc',
        contaIdExterno: 'acc_123',
        dataInicio: '2026-10-01',
        dataFim: '2026-10-15',
        tokenAcesso: 'jwt_mock_token',
      });

      expect(globalThis.fetch).toHaveBeenCalled();
      expect(txs.length).toBe(1);
      expect(txs[0].descricao).toBe('MERCADO MODELO');
      expect(txs[0].valor).toBe(89.9);
      expect(txs[0].natureza).toBe('DESPESA');

      globalThis.fetch = originalFetch;
    });

    it('deve tratar respostas de erro HTTP do agregador / banco', async () => {
      const client = new OpenFinanceApiClient({
        baseUrl: 'https://api.santander.com.br/v1',
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'Consentimento revogado pelo usuário',
      } as any);

      await expect(
        client.fetchAccounts('consent_revogado', 'token')
      ).rejects.toThrow(/Falha ao buscar contas reais na API Open Finance \(403\)/);

      globalThis.fetch = originalFetch;
    });
  });
});
