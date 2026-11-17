import { describe, expect, it } from 'vitest';
import { inferirTipoDocumentoImportado } from './classificacao-documento.util.js';

describe('inferirTipoDocumentoImportado', () => {
  it('não transforma extrato de conta em fatura por uma linha isolada', () => {
    const lancamentos = [
      ...Array.from({ length: 246 }, () => ({ tipoConta: 'CONTA_CORRENTE' })),
      { tipoConta: 'CARTAO_CREDITO' },
    ];
    expect(inferirTipoDocumentoImportado(lancamentos)).toBe('EXTRATO_CONTA_CORRENTE');
  });

  it('não transforma extrato corrente em investimento por lançamento isolado ou aporte', () => {
    const lancamentos = [
      ...Array.from({ length: 58 }, () => ({ tipoConta: 'CONTA_CORRENTE' })),
      { tipoConta: 'INVESTIMENTO' },
    ];
    expect(inferirTipoDocumentoImportado(lancamentos)).toBe('EXTRATO_CONTA_CORRENTE');
  });

  it('mantém a classificação quando todos os lançamentos são de fatura', () => {
    expect(inferirTipoDocumentoImportado([{ tipoConta: 'CARTAO_CREDITO' }])).toBe('FATURA_CARTAO');
  });

  it('não marca como fatura quando cartão é minoria entre linhas sem tipo reconhecido', () => {
    expect(inferirTipoDocumentoImportado([
      { tipoConta: 'CARTAO_CREDITO' },
      { tipoConta: 'OUTRO' },
      { tipoConta: 'OUTRO' },
    ])).toBe('OUTRO');
  });

  it('não escolhe fatura em empate entre conta corrente e cartão', () => {
    expect(inferirTipoDocumentoImportado([
      { tipoConta: 'CARTAO_CREDITO' },
      { tipoConta: 'CONTA_CORRENTE' },
    ])).toBe('OUTRO');
  });

  it('classifica um conjunto majoritariamente de investimento como extrato de investimento', () => {
    expect(inferirTipoDocumentoImportado([
      { tipoConta: 'INVESTIMENTO' },
      { tipoConta: 'INVESTIMENTO' },
      { tipoConta: 'CONTA_CORRENTE' },
    ])).toBe('EXTRATO_INVESTIMENTO');
  });
});
