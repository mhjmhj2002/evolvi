import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed de categorias e benchmarks...');

  const dataPath = path.join(__dirname, 'categories_seed_data.json');
  const fileContent = fs.readFileSync(dataPath, 'utf-8');
  const { categorias, subcategorias } = JSON.parse(fileContent);

  for (const cat of categorias) {
    let existing = await prisma.categoria.findFirst({
      where: {
        nome: cat.nome,
        usuarioId: null,
        categoriaPaiId: null,
      },
    });

    if (!existing) {
      existing = await prisma.categoria.create({
        data: {
          nome: cat.nome,
          ordem: cat.ordem,
          pesoBrutoReferencia: cat.pesoBrutoReferencia,
          referenciaNormalizadaPct: cat.referenciaNormalizadaPct,
          descricao: cat.condicaoAcao ? cat.condicaoAcao.slice(0, 255) : null,
        },
      });
    } else {
      existing = await prisma.categoria.update({
        where: { id: existing.id },
        data: {
          ordem: cat.ordem,
          pesoBrutoReferencia: cat.pesoBrutoReferencia,
          referenciaNormalizadaPct: cat.referenciaNormalizadaPct,
          descricao: cat.condicaoAcao ? cat.condicaoAcao.slice(0, 255) : null,
        },
      });
    }

    // Se houver subcategorias para esta categoria principal
    const subcats = subcategorias[cat.nome] || [];
    for (const sub of subcats) {
      const existingSub = await prisma.categoria.findFirst({
        where: {
          nome: sub.nome,
          categoriaPaiId: existing.id,
          usuarioId: null,
        },
      });

      if (!existingSub) {
        await prisma.categoria.create({
          data: {
            nome: sub.nome,
            descricao: sub.descricao ? sub.descricao.slice(0, 255) : null,
            categoriaPaiId: existing.id,
          },
        });
      }
    }
  }

  const countCategorias = await prisma.categoria.count({ where: { categoriaPaiId: null } });
  const countSubcategorias = await prisma.categoria.count({ where: { categoriaPaiId: { not: null } } });

  console.log(`✅ Seed concluído com sucesso!`);
  console.log(`📊 Categorias principais (POF): ${countCategorias}`);
  console.log(`📊 Subcategorias: ${countSubcategorias}`);
}

main()
  .catch((e) => {
    console.error('❌ Erro durante a execução do seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
