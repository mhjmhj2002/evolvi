import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from './prisma.js';

describe('Database Connection & Schema Test', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('deve conectar ao PostgreSQL e listar as 21 categorias da POF', async () => {
    const categorias = await prisma.categoria.findMany({
      where: { categoriaPaiId: null },
      orderBy: { ordem: 'asc' },
    });

    expect(categorias.length).toBe(21);
    const nomes = categorias.map((c) => c.nome);
    expect(nomes).toContain('Moradia');
    expect(nomes).toContain('Alimentacao');
    expect(nomes).toContain('Transporte');
    expect(nomes).toContain('Educacao');
  });

  it('deve permitir criar e consultar um usuário de teste e limpar em seguida', async () => {
    const testEmail = `teste_${Date.now()}@evolvi.app`;
    const usuario = await prisma.usuario.create({
      data: {
        nome: 'Usuario Teste Migracao',
        email: testEmail,
        senhaHash: 'hash_seguro_fake_123',
        rendaBaseMensal: 11000.0,
      },
    });

    expect(usuario.id).toBeDefined();
    expect(usuario.email).toBe(testEmail);
    expect(Number(usuario.rendaBaseMensal)).toBe(11000.0);

    // Limpeza
    await prisma.usuario.delete({
      where: { id: usuario.id },
    });

    const deleted = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(deleted).toBeNull();
  });
});
