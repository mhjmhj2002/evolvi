import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../infrastructure/database/prisma.js';
import {
  saoDuplicatasSemanticas,
  saoMesmaInstituicaoOuEquivalente,
  ValidacaoDeduplicacaoService,
} from './validacao-deduplicacao.service.js';
import { extrairRaizComerciante } from './movimento.util.js';
import crypto from 'node:crypto';

describe('TASK-47: Deduplicação de Baixa Materialidade e Equivalência Aprimorada', () => {
  let usuarioTesteId: string;

  beforeEach(async () => {
    const usuario = await prisma.usuario.create({
      data: {
        email: `task47-test-${crypto.randomUUID()}@evolvi.app`,
        nome: 'Usuario Teste TASK-47',
        senhaHash: 'hash-fake',
        role: 'USER',
      },
    });
    usuarioTesteId = usuario.id;
  });

  afterEach(async () => {
    if (usuarioTesteId) {
      await prisma.movimento.deleteMany({ where: { usuarioId: usuarioTesteId } });
      await prisma.conta.deleteMany({ where: { usuarioId: usuarioTesteId } });
      await prisma.usuario.deleteMany({ where: { id: usuarioTesteId } });
    }
  });

  it('1. extrairRaizComerciante deve lidar com travessão em-dash (—) e en-dash (–)', () => {
    expect(extrairRaizComerciante('PADARIA DINIZ – VILA VELHA')).toBe('PADARIA DINIZ');
    expect(extrairRaizComerciante('PADARIA DINIZ — VILA VELHA')).toBe('PADARIA DINIZ');
    expect(extrairRaizComerciante('PADARIA DINIZ - Parcela 1/2')).toBe('PADARIA DINIZ');
    expect(extrairRaizComerciante('PADARIA DINIZ – Parcela 1/2')).toBe('PADARIA DINIZ');
  });

  it('2. saoMesmaInstituicaoOuEquivalente deve unificar contas por numeroConta e digitosCartao', () => {
    const contaA = { nome: 'Conta Corrente', numeroConta: '24220973-2', digitosCartao: null };
    const contaB = { nome: 'Banco Inter', numeroConta: '24220973', digitosCartao: null };

    expect(saoMesmaInstituicaoOuEquivalente(contaA, 'extrato.csv', contaB, 'app_inter.ofx')).toBe(true);

    const cartaoA = { nome: 'Cartão de Crédito', numeroConta: null, digitosCartao: '2458' };
    const cartaoB = { nome: 'C6 Carbon Final 2458', numeroConta: null, digitosCartao: '2458' };

    expect(saoMesmaInstituicaoOuEquivalente(cartaoA, 'fatura.pdf', cartaoB, 'c6.csv')).toBe(true);
  });

  it('3. saoMesmaInstituicaoOuEquivalente deve unificar conta genérica com nome de instituição do mesmo arquivo', () => {
    const contaGenerica = { nome: 'Conta Bancária', numeroConta: null, digitosCartao: null };
    const contaInstituicao = { nome: 'Nubank', numeroConta: null, digitosCartao: null };

    // Arquivo da conta genérica referencia nu_ ou nubank
    expect(
      saoMesmaInstituicaoOuEquivalente(contaGenerica, 'nu_extrato.csv', contaInstituicao, 'nubank.ofx')
    ).toBe(true);
  });

  it('4. saoDuplicatasSemanticas deve deduplicar lançamentos de baixa materialidade (< 50) com similaridade >= 0.70', () => {
    const lancamentoA = {
      descricao: 'PADARIA DINIZ VILA VELHA',
      valor: 7.6,
    };
    const lancamentoB = {
      descricao: 'PADARIA DINIZ - VILA VELHA BRA',
      valor: 7.6,
    };

    // Mesma data e valor < 50
    expect(saoDuplicatasSemanticas(lancamentoA, lancamentoB)).toBe(true);
  });

  it('5. saoDuplicatasSemanticas deve PRESERVAR ordinais distintos mesmo em baixa materialidade', () => {
    const lancamentoA = {
      descricao: 'BARRACA DO JULIO',
      valor: 15.0,
    };
    const lancamentoB = {
      descricao: 'BARRACA DO JULIO I',
      valor: 15.0,
    };

    // Ordinais comprovadamente diferentes ("I" vs sem ordinal) NÃO são duplicatas
    expect(saoDuplicatasSemanticas(lancamentoA, lancamentoB)).toBe(false);
  });

  it('6. Malha fina deve excluir duplicata de baixa materialidade e marcar validadoDedupe = "S"', async () => {
    const conta = await prisma.conta.create({
      data: {
        usuarioId: usuarioTesteId,
        nome: 'Conta Corrente C6 Bank',
        tipo: 'CONTA_CORRENTE',
        numeroConta: '24220973',
      },
    });

    const dataHoje = new Date('2026-10-10T12:00:00.000Z');

    const mov1 = await prisma.movimento.create({
      data: {
        usuarioId: usuarioTesteId,
        contaId: conta.id,
        dataMovimento: dataHoje,
        competencia: '2026-10',
        descricao: 'PADARIA DINIZ VILA VELHA',
        valor: 7.6,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
        origemDocumento: 'extrato_c6.csv',
      },
    });

    const mov2 = await prisma.movimento.create({
      data: {
        usuarioId: usuarioTesteId,
        contaId: conta.id,
        dataMovimento: dataHoje,
        competencia: '2026-10',
        descricao: 'PADARIA DINIZ - VILA VELHA BRA',
        valor: 7.6,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
        origemDocumento: 'extrato_c6_app.csv',
      },
    });

    const resultadoMalhaFina = await ValidacaoDeduplicacaoService.executarMalhaFinaParaUsuario(usuarioTesteId);

    expect(resultadoMalhaFina.totalDuplicatasExcluidas).toBe(1);

    const restantes = await prisma.movimento.findMany({
      where: { usuarioId: usuarioTesteId },
    });
    expect(restantes.length).toBe(1);
    expect(restantes[0].validadoDedupe).toBe('S');
  });

  it('7. saoDuplicatasSemanticas e saoDistintosPorIdentificador devem tratar recargas distintas automaticamente como NÃO duplicatas', () => {
    const recargaA = {
      descricao: 'RECARGAPAY *TIM12',
      valor: 30.0,
    };
    const recargaB = {
      descricao: 'RECARGAPAY *TIM23',
      valor: 30.0,
    };

    expect(saoDuplicatasSemanticas(recargaA, recargaB)).toBe(false);
  });

  it('8. Malha fina NÃO deve excluir recargas com códigos distintivos no mesmo dia e deve marcar ambas como validadas', async () => {
    const conta = await prisma.conta.create({
      data: {
        usuarioId: usuarioTesteId,
        nome: 'C6 Carbon Final 7936',
        tipo: 'CARTAO_CREDITO',
        digitosCartao: '7936',
      },
    });

    const dataHoje = new Date('2026-06-06T12:00:00.000Z');

    await prisma.movimento.create({
      data: {
        usuarioId: usuarioTesteId,
        contaId: conta.id,
        dataMovimento: dataHoje,
        competencia: '2026-06',
        descricao: 'RECARGAPAY *TIM12',
        valor: 30.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
        origemDocumento: 'fatura_c6.pdf',
      },
    });

    await prisma.movimento.create({
      data: {
        usuarioId: usuarioTesteId,
        contaId: conta.id,
        dataMovimento: dataHoje,
        competencia: '2026-06',
        descricao: 'RECARGAPAY *TIM23',
        valor: 30.0,
        natureza: 'DESPESA',
        status: 'CONCILIADO',
        validadoDedupe: 'N',
        origemDocumento: 'fatura_c6.pdf',
      },
    });

    const resultadoMalhaFina = await ValidacaoDeduplicacaoService.executarMalhaFinaParaUsuario(usuarioTesteId);

    expect(resultadoMalhaFina.totalDuplicatasExcluidas).toBe(0);

    const restantes = await prisma.movimento.findMany({
      where: { usuarioId: usuarioTesteId },
    });
    expect(restantes.length).toBe(2);
    expect(restantes[0].validadoDedupe).toBe('S');
    expect(restantes[1].validadoDedupe).toBe('S');
  });
});
