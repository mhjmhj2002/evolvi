import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { calcularDigitoVerificadorModulo11 } from './nota-fiscal.util.js';

describe('TASK-54: Leitura e Lançamento por Nota Fiscal (QR Code / Chave 44 Dígitos / NFC-e)', () => {
  let app: FastifyInstance;

  const testUserA = {
    nome: 'Usuario Nota Fiscal A',
    email: `nfe_user_a_${Date.now()}@teste.com`,
    senha: 'SenhaForte123!',
    rendaBaseMensal: 6000.0,
  };

  const testUserB = {
    nome: 'Usuario Nota Fiscal B (Outro Tenant)',
    email: `nfe_user_b_${Date.now()}@teste.com`,
    senha: 'SenhaForte123!',
    rendaBaseMensal: 5000.0,
  };

  let tokenA: string;
  let userAId: string;
  let tokenB: string;
  let userBId: string;

  let contaAId: string;
  let contaBId: string;
  let categoriaAlimentacaoId: string;

  // Gerar chave válida de 44 dígitos
  const chaveBase43 = '3526031234567800019565001000123456112345678';
  const dvValido = calcularDigitoVerificadorModulo11(chaveBase43);
  const chaveValida44 = `${chaveBase43}${dvValido}`;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Criar usuário A
    const resA = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: testUserA,
    });
    const bodyA = JSON.parse(resA.body);
    tokenA = bodyA.token;
    userAId = bodyA.usuario.id;

    // 2. Criar usuário B (multi-tenant)
    const resB = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: testUserB,
    });
    const bodyB = JSON.parse(resB.body);
    tokenB = bodyB.token;
    userBId = bodyB.usuario.id;

    // 3. Criar conta para usuário A
    const resContaA = await app.inject({
      method: 'POST',
      url: '/api/contas',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        nome: 'Nubank Usuário A',
        tipo: 'CONTA_CORRENTE',
        saldoInicial: 1000.0,
      },
    });
    contaAId = JSON.parse(resContaA.body).conta.id;

    // 4. Criar conta para usuário B
    const resContaB = await app.inject({
      method: 'POST',
      url: '/api/contas',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {
        nome: 'Inter Usuário B',
        tipo: 'CONTA_CORRENTE',
        saldoInicial: 500.0,
      },
    });
    contaBId = JSON.parse(resContaB.body).conta.id;

    // 5. Obter categoria de Alimentação existente
    const cat = await prisma.categoria.findFirst({
      where: { nome: 'Alimentação' },
    });
    if (cat) {
      categoriaAlimentacaoId = cat.id;
    }
  });

  afterAll(async () => {
    if (userAId || userBId) {
      await prisma.movimento.deleteMany({
        where: { usuarioId: { in: [userAId, userBId].filter(Boolean) } },
      });
      await prisma.conta.deleteMany({
        where: { usuarioId: { in: [userAId, userBId].filter(Boolean) } },
      });
      await prisma.usuario.deleteMany({
        where: { id: { in: [userAId, userBId].filter(Boolean) } },
      });
    }
    await app.close();
  });

  it('deve verificar que nota fiscal é inédita inicialmente', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/movimentos/nota-fiscal/verificar/${chaveValida44}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.duplicada).toBe(false);
    expect(body.chaveAcessoNfe).toBe(chaveValida44);
  });

  it('deve rejeitar verificação de chave inválida', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/movimentos/nota-fiscal/verificar/123456',
      headers: { authorization: `Bearer ${tokenA}` },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.message).toContain('inválida');
  });

  it('deve consultar e decodificar dados da nota a partir de URL de QR Code', async () => {
    const urlQrCode = `https://www.nfce.fazenda.sp.gov.br/qrcode?p=${chaveValida44}|2|1|15|214.80|A1B2C3D4|1`;

    const res = await app.inject({
      method: 'POST',
      url: '/api/movimentos/nota-fiscal/consultar',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { input: urlQrCode },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sucesso).toBe(true);
    expect(body.duplicada).toBe(false);
    expect(body.dadosNota.chaveAcesso).toBe(chaveValida44);
    expect(body.dadosNota.valorTotal).toBe(214.8);
    expect(body.dadosNota.uf).toBe('SP');
    expect(body.dadosNota.cnpj).toBe('12345678000195');
    expect(body.dadosNota.dataEmissao).toBe('2026-03-15');
    expect(body.dadosNota.categoriaSugeridaId).toBeDefined();
  });

  it('deve lançar movimento com chaveAcessoNfe com sucesso', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/movimentos',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        contaId: contaAId,
        categoriaId: categoriaAlimentacaoId,
        dataMovimento: '2026-03-15',
        descricao: 'Supermercado Pão de Açúcar (NFC-e)',
        valor: 214.8,
        natureza: 'DESPESA',
        chaveAcessoNfe: chaveValida44,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.movimento.chaveAcessoNfe).toBe(chaveValida44);
    expect(body.movimento.valor).toBe(214.8);
  });

  it('deve BLOQUEAR com 409 quando tentar lançar a mesma nota fiscal novamente para o mesmo usuário', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/movimentos',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        contaId: contaAId,
        categoriaId: categoriaAlimentacaoId,
        dataMovimento: '2026-03-15',
        descricao: 'Tentativa duplicada de supermercado',
        valor: 214.8,
        natureza: 'DESPESA',
        chaveAcessoNfe: chaveValida44,
      },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.duplicadaNfe).toBe(true);
    expect(body.message).toContain('já foi lançada anteriormente');
    expect(body.movimentoExistente).toBeDefined();
    expect(body.movimentoExistente.descricao).toBe('Supermercado Pão de Açúcar (NFC-e)');
    expect(body.movimentoExistente.valor).toBe(214.8);
    expect(body.movimentoExistente.conta.nome).toBe('Nubank Usuário A');
  });

  it('deve detectar duplicidade pelo endpoint de verificação e retornar detalhes do lançamento existente', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/movimentos/nota-fiscal/verificar/${chaveValida44}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.duplicada).toBe(true);
    expect(body.movimento).toBeDefined();
    expect(body.movimento.descricao).toBe('Supermercado Pão de Açúcar (NFC-e)');
    expect(body.movimento.valor).toBe(214.8);
    expect(body.movimento.dataMovimento).toBe('2026-03-15');
    expect(body.movimento.conta.nome).toBe('Nubank Usuário A');
  });

  it('deve garantir isolamento multi-tenant: usuário B não deve ver ou sofrer colisão da nota do usuário A', async () => {
    // 1. Usuário B consulta a mesma chave
    const resVerifB = await app.inject({
      method: 'GET',
      url: `/api/movimentos/nota-fiscal/verificar/${chaveValida44}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });

    expect(resVerifB.statusCode).toBe(200);
    const bodyVerifB = JSON.parse(resVerifB.body);
    expect(bodyVerifB.duplicada).toBe(false);

    // 2. Usuário B consegue lançar a mesma nota em sua conta isoladamente
    const resPostB = await app.inject({
      method: 'POST',
      url: '/api/movimentos',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {
        contaId: contaBId,
        categoriaId: categoriaAlimentacaoId,
        dataMovimento: '2026-03-15',
        descricao: 'Supermercado Usuário B',
        valor: 214.8,
        natureza: 'DESPESA',
        chaveAcessoNfe: chaveValida44,
      },
    });

    expect(resPostB.statusCode).toBe(201);
  });
});
