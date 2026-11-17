import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiIaExtratorClient } from './ia-extrator.client.js';

const respostaGemini = (transacoes: unknown[]) => ({
  ok: true,
  status: 200,
  json: async () => ({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ transacoes }) }] } }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40, totalTokenCount: 140 },
  }),
  text: async () => '',
});

const contexto = {
  contas: [{ id: 'conta-cartao', nome: 'Cartão principal', tipo: 'CARTAO_CREDITO', digitosCartao: '2458' }],
  categorias: [{ id: 'categoria-alimentacao', nome: 'Alimentação' }],
  dataReferencia: '2026-01-20',
};

describe('TASK-62: regressão de extração universal sem regras por instituição', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    {
      arquivo: 'statement-layout-a.pdf',
      entrada: 'Resumo da conta\nData | Lançamento | Valor\n05/01 | Mercado Central | R$ 75,00\nFinal do cartão: 2458',
      transacao: { dataMovimento: '2026-01-05', descricao: 'Mercado Central', valor: 75, natureza: 'DESPESA', contaSugerida: 'Cartão principal', tipoConta: 'CARTAO_CREDITO', digitosCartao: '2458', categoriaSugerida: 'Alimentação', isPagamentoFatura: false },
    },
    {
      arquivo: 'statement-layout-b.pdf',
      entrada: 'MOVIMENTAÇÕES DO PERÍODO\n05 jan 2026 - Mercado Central - 75,00 D\nCartão **** 2458',
      transacao: { dataMovimento: '2026-01-05', descricao: 'Mercado Central', valor: 75, natureza: 'DESPESA', contaSugerida: 'Cartão principal', tipoConta: 'CARTAO_CREDITO', digitosCartao: '2458', categoriaSugerida: 'Alimentação', isPagamentoFatura: false },
    },
  ])('processa $arquivo pelo prompt e schema universais', async ({ arquivo, entrada, transacao }) => {
    const fetchMock = vi.fn().mockResolvedValue(respostaGemini([transacao]));
    vi.stubGlobal('fetch', fetchMock);
    const client = new GeminiIaExtratorClient('fixture-api-key');
    const resultado = await client.extrairTransacoes({
      nomeArquivo: arquivo,
      mimeType: 'application/pdf',
      conteudoBuffer: Buffer.from('%PDF-fixture'),
      conteudoTexto: entrada,
      provedorIa: 'GEMINI',
      contexto,
    });

    expect(resultado).toHaveLength(1);
    expect(resultado[0]).toMatchObject({ descricao: 'Mercado Central', valor: 75, dataMovimento: '2026-01-05' });
    const requisicao = JSON.parse(fetchMock.mock.calls[0][1].body);
    const prompt = requisicao.contents[0].parts[0].text as string;
    expect(prompt).toContain(entrada);
    expect(prompt).toContain('não infira conta, produto ou layout a partir da marca');
    expect(prompt).not.toMatch(/Santander|Nubank|Itaú|Inter|C6 Bank/);
  });

  it('preserva lançamentos iguais em chunks distintos e falha fechado para conteúdo ilegível', async () => {
    const compra = { dataMovimento: '2026-01-05', descricao: 'Compra recorrente legítima', valor: 12.5, natureza: 'DESPESA', tipoConta: 'CONTA_CORRENTE', isPagamentoFatura: false };
    const fetchMock = vi.fn().mockResolvedValue(respostaGemini([compra]));
    vi.stubGlobal('fetch', fetchMock);
    const client = new GeminiIaExtratorClient('fixture-api-key');
    const resultado = await client.extrairTransacoes({
      nomeArquivo: 'statement-long-layout.pdf', mimeType: 'application/pdf', conteudoBuffer: Buffer.from('%PDF-fixture'),
      conteudoTexto: `${'Página de movimentos\n'.repeat(400)}fim do documento`, provedorIa: 'GEMINI', contexto,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(resultado.filter((item) => item.descricao === 'Compra recorrente legítima')).toHaveLength(3);

    const local = client.extrairLocalDeterministic({
      nomeArquivo: 'corrompido.pdf', conteudoBuffer: Buffer.from([0, 31, 139, 8, 0]), contexto,
    });
    expect(local).toEqual([]);
  });
});
