import { describe, expect, it } from 'vitest';
import { inferirPeriodoExtrato, validarDatasContraPeriodo } from './validacao-consistencia-conteudo.util.js';

describe('validacao de consistencia do conteudo do extrato', () => {
  it('infere intervalo de datas completo a partir do nome do arquivo', () => {
    expect(inferirPeriodoExtrato('extrato-01-04-2026-a-31-10-2026.pdf'))
      .toEqual({ inicio: '2026-04-01', fim: '2026-10-31', origem: 'nome_arquivo' });
  });

  it('corrige o ano quando o dia e mês pertencem unicamente ao período explícito', () => {
    const periodo = inferirPeriodoExtrato('extrato-01-04-2026-a-31-10-2026.pdf')!;
    expect(validarDatasContraPeriodo(['2024-07-14', '2026-07-15'], periodo)).toEqual({
      datas: [
        { original: '2024-07-14', final: '2026-07-14', corrigida: true },
        { original: '2026-07-15', final: '2026-07-15', corrigida: false },
      ],
      inconsistencias: [],
    });
  });

  it('retorna inconsistência para uma data que não pode ser corrigida sem ambiguidade', () => {
    const periodo = inferirPeriodoExtrato('extrato-01-04-2026-a-31-10-2026.pdf')!;
    const resultado = validarDatasContraPeriodo(['2024-12-14'], periodo);
    expect(resultado.datas[0]).toEqual({ original: '2024-12-14', final: '2024-12-14', corrigida: false });
    expect(resultado.inconsistencias).toHaveLength(1);
  });

  it('usa inventário da IA para alertar, sem corrigir automaticamente datas', () => {
    const periodo = inferirPeriodoExtrato('extrato.pdf', new Date('2026-04-01T00:00:00Z'), new Date('2026-10-31T00:00:00Z'))!;
    const resultado = validarDatasContraPeriodo(['2024-07-14'], periodo);
    expect(resultado.datas[0]).toEqual({ original: '2024-07-14', final: '2024-07-14', corrigida: false });
    expect(resultado.inconsistencias).toHaveLength(1);
  });
});
