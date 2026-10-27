import { describe, it, expect, beforeAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import {
  MovimentoRecalculoService,
  REGEX_APORTES_INVESTIMENTOS,
} from './movimento-recalculo.service.js';
import { baselineService } from '../fase1/baseline.service.js';
import { historicoConsumoService } from '../fase1/historico.service.js';

describe('TASK-44: Reconhecimento de Aportes/Investimentos e Isolamento de Gastos de Consumo', () => {
  let app: FastifyInstance;
  let usuarioId: string;
  let usuarioToken: string;
  let contaId: string;
  let categoriaInvestimentosId: string;
  let categoriaAlimentacaoId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Criar Usuário de Teste
    const email = `user-task44-${Date.now()}@teste.com`;
    const resCad = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario Task44 Aportes',
        email,
        senha: 'SenhaForte123!',
      },
    });
    const bodyCad = JSON.parse(resCad.body);
    usuarioId = bodyCad.usuario.id;
    usuarioToken = bodyCad.token;

    const conta = await prisma.conta.create({
      data: {
        usuarioId,
        nome: 'Conta XP Investimentos',
        tipo: 'INVESTIMENTO',
      },
    });
    contaId = conta.id;

    // Buscar ou criar categorias de teste
    let catInv = await prisma.categoria.findFirst({
      where: {
        OR: [
          { nome: { equals: 'Aplicações / Investimentos', mode: 'insensitive' } },
          { nome: { equals: 'Investimentos', mode: 'insensitive' } },
        ],
      },
    });
    if (!catInv) {
      catInv = await prisma.categoria.create({
        data: { nome: 'Aplicações / Investimentos' },
      });
    }
    categoriaInvestimentosId = catInv.id;

    let catAlim = await prisma.categoria.findFirst({
      where: {
        OR: [
          { nome: { equals: 'Alimentação', mode: 'insensitive' } },
          { nome: { equals: 'Alimentacao', mode: 'insensitive' } },
        ],
      },
    });
    if (!catAlim) {
      catAlim = await prisma.categoria.create({
        data: { nome: 'Alimentação' },
      });
    }
    categoriaAlimentacaoId = catAlim.id;
  });

  it('1. Deve validar regex REGEX_APORTES_INVESTIMENTOS com diversas descrições bancárias', () => {
    const termosValidos = [
      'APLICAÇÃO DE CDB INTER',
      'APLICACAO FUNDO DI',
      'APLICACAO RDB NUBANK',
      'INVESTIMENTO TESOURO DIRETO SELIC',
      'APORTE POUPANCA CAIXA',
      'COMPRA ACOES PETR4',
      'APLICACAO LCI BANCO DO BRASIL',
      'APORTE LCA CAIXA',
      'COMPRA DE FII HGLG11',
      'SUBSCRICAO ACOES VALE3',
      'DEPOSITO POUPANCA',
      'B3 APLICACAO ACOES',
    ];

    for (const termo of termosValidos) {
      expect(REGEX_APORTES_INVESTIMENTOS.test(termo)).toBe(true);
    }

    const termosNaoInvestimento = [
      'IFOOD REFEICAO',
      'MERCADO COMPRA MENSAL',
      'SUPERMERCADO CARREFOUR',
      'UBER VIAGEM',
      'NETFLIX ASSINATURA',
    ];

    for (const termo of termosNaoInvestimento) {
      expect(REGEX_APORTES_INVESTIMENTOS.test(termo)).toBe(false);
    }
  });

  it('2. Importação em lote POST /api/movimentos/importar deve classificar aportes como APORTE_PATRIMONIAL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/movimentos/importar',
      headers: {
        authorization: `Bearer ${usuarioToken}`,
      },
      payload: {
        movimentos: [
          {
            contaId,
            dataMovimento: '2026-03-10',
            descricao: 'APLICAÇÃO DE CDB BANCO INTER',
            valor: 5000,
            natureza: 'DESPESA',
          },
          {
            contaId,
            dataMovimento: '2026-03-11',
            descricao: 'SUPERMERCADO DIA',
            valor: 150,
            natureza: 'DESPESA',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.resumo.inseridos).toBe(2);

    const movs = await prisma.movimento.findMany({
      where: { usuarioId },
      orderBy: { dataMovimento: 'asc' },
    });

    const movAporte = movs.find((m) => m.descricao.includes('CDB'));
    const movConsumo = movs.find((m) => m.descricao.includes('SUPERMERCADO'));

    expect(movAporte).toBeDefined();
    expect(movAporte?.natureza).toBe('APORTE_PATRIMONIAL');

    expect(movConsumo).toBeDefined();
    expect(movConsumo?.natureza).toBe('DESPESA');
  });

  it('3. MovimentoRecalculoService deve reclassificar DESPESA retroativa como APORTE_PATRIMONIAL respeitando categoriaFixadaPeloUsuario', async () => {
    const service = new MovimentoRecalculoService(prisma);

    // Garantir que a versão do usuário está defasada para disparar recálculo
    await prisma.usuario.update({
      where: { id: usuarioId },
      data: { versaoRegrasMovimentos: 1 },
    });

    // Criar movimento antigo que veio como DESPESA (não travado)
    const movAporteAntigo = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        categoriaId: categoriaInvestimentosId,
        dataMovimento: new Date('2026-01-15T00:00:00.000Z'),
        competencia: '2026-01',
        descricao: 'INVESTIMENTO TESOURO DIRETO IPCA+ 2035',
        valor: 10000,
        natureza: 'DESPESA',
        categoriaFixadaPeloUsuario: false,
      },
    });

    // Criar movimento antigo com categoriaFixadaPeloUsuario = true (NÃO deve ser alterado)
    const movTravado = await prisma.movimento.create({
      data: {
        usuarioId,
        contaId,
        categoriaId: categoriaAlimentacaoId,
        dataMovimento: new Date('2026-01-16T00:00:00.000Z'),
        competencia: '2026-01',
        descricao: 'APLICACAO PRODUTO ARTESANAL MERCADO',
        valor: 80,
        natureza: 'DESPESA',
        categoriaFixadaPeloUsuario: true,
      },
    });

    // Executar recálculo estritamente
    const resultado = await MovimentoRecalculoService.verificarERecalcularSeNecessario(usuarioId, true);
    expect(resultado.recalculado).toBe(true);
    expect(resultado.totalConvertidosParaAportePatrimonial).toBeGreaterThanOrEqual(1);

    // Verificar se o não-travado foi convertido para APORTE_PATRIMONIAL
    const atualizado = await prisma.movimento.findUnique({
      where: { id: movAporteAntigo.id },
    });
    expect(atualizado?.natureza).toBe('APORTE_PATRIMONIAL');

    // Verificar que o travado foi intocado
    const intocado = await prisma.movimento.findUnique({
      where: { id: movTravado.id },
    });
    expect(intocado?.natureza).toBe('DESPESA');
    expect(intocado?.categoriaFixadaPeloUsuario).toBe(true);
  });

  it('4. Cálculos da Fase 1 (Baseline e Histórico de Gastos) devem excluir APORTE_PATRIMONIAL', async () => {
    // Buscar baseline do usuário para competência 2026-03 (meses fechados anteriores: 2025-09 até 2026-02)
    // O movimento de R$ 10.000 em 2026-01 agora é APORTE_PATRIMONIAL, portanto não deve constar como despesa de R$ 10.000 / 6 = ~1.666
    // Deve constar apenas a despesa de R$ 80 do produto artesanal em Alimentação (~R$ 13,33)
    const baseline = await baselineService.calcularBaseline(usuarioId, '2026-03');
    for (const item of baseline.detalhes_categorias) {
      expect(item.media_mensal).toBeLessThan(100);
    }

    // Buscar histórico de consumo
    const resumo = await historicoConsumoService.obterResumoHistorico(usuarioId, '2026-03');
    // media_mensal_despesas não deve contabilizar aportes patrimoniais (R$ 10.000)
    expect(resumo.media_mensal_despesas).toBeLessThan(100);
  });

  it('5. GET /api/movimentos deve isolar totalAportesPatrimoniais de totalDespesasConsumo', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/movimentos?competencia=2026-03',
      headers: {
        authorization: `Bearer ${usuarioToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.resumo.totalAportesPatrimoniais).toBe(5000);
    expect(body.resumo.totalDespesasConsumo).toBe(150);
  });
});
