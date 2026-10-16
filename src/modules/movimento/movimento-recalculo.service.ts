import { prisma } from '../../infrastructure/database/prisma.js';
import { classificadorCombinatorioService } from './classificador-combinatorio.service.js';

/**
 * Versão corrente do catálogo de regras determinísticas de negócio de movimentos.
 * Incrementar este número sempre que novas regras de classificação forem adicionadas
 * ou corrigidas no sistema.
 * Versão 2: BUG-09 (Salário / Proventos / PLR universal)
 * Versão 3: TASK-43 (Inteligência Combinatória Nome + Dia da Semana e trava manual do usuário)
 */
export const VERSAO_REGRAS_MOVIMENTOS_ATUAL = 3;

/**
 * Regex universal para identificação de proventos, remuneração, folha de pagamento,
 * contas salário e PLR (Participação nos Lucros e Resultados / Bônus).
 * Conforme convenção Febraban/BACEN, mesmo que o titular conste como favorecido/remetente,
 * a liquidação através de conta salário ou TED de folha representa RECEITA legítima.
 */
export const REGEX_PROVENTOS_SALARIO_PLR =
  /ted\s*conta\s*sal[aá]rio|cred\s*(ted\s*)?sal[aá]rio|folha\s*pag(amento)?|remunera[cç][aã]o|pagamento\s*de\s*sal[aá]rio|(?:\b|^)plr(?:\b|$)|participa[cç][aã]o\s*lucros|b[oô]nus\s*salarial|abono\s*salarial|13[oº]?\s*sal[aá]rio|sal[aá]rio\s*mensal/i;

export interface RecalculoMovimentosResultado {
  usuarioId: string;
  versaoAnterior: number;
  versaoAplicada: number;
  recalculado: boolean;
  totalMovimentosAvaliados: number;
  totalConvertidosParaReceita: number;
  totalCategoriasRefinadasCombinatorio?: number;
  erros?: string[];
}

export class MovimentoRecalculoService {
  /**
   * Verifica se o usuário autenticado precisa de saneamento e recálculo de movimentos
   * com base na versão das regras já aplicadas.
   */
  public static async verificarERecalcularSeNecessario(
    usuarioId: string
  ): Promise<RecalculoMovimentosResultado> {
    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true, nome: true, versaoRegrasMovimentos: true },
    });

    if (!usuario) {
      throw new Error(`Usuário [${usuarioId}] não encontrado.`);
    }

    const versaoAnterior = usuario.versaoRegrasMovimentos ?? 1;

    // Se já estiver na versão atual ou superior, não reprocessa
    if (versaoAnterior >= VERSAO_REGRAS_MOVIMENTOS_ATUAL) {
      return {
        usuarioId,
        versaoAnterior,
        versaoAplicada: versaoAnterior,
        recalculado: false,
        totalMovimentosAvaliados: 0,
        totalConvertidosParaReceita: 0,
        totalCategoriasRefinadasCombinatorio: 0,
      };
    }

    // Executa recálculo estritamente isolado para o usuário
    return await this.executarRecalculoParaUsuario(usuarioId, versaoAnterior);
  }

  /**
   * Executa a rotina de saneamento para o usuário e atualiza versaoRegrasMovimentos no banco.
   * Isolamento Multi-tenant estrito: filtros sempre fixados no usuarioId.
   * REGRA DE OURO (TASK-43): Registros com categoriaFixadaPeloUsuario === true são intocáveis.
   */
  public static async executarRecalculoParaUsuario(
    usuarioId: string,
    versaoAnterior: number = 1
  ): Promise<RecalculoMovimentosResultado> {
    // 1. Busca todos os movimentos do usuário que estejam como TRANSFERENCIA_PROPRIA
    // mas cuja descrição atenda ao padrão universal de salários/proventos/PLR (BUG-09)
    const movimentosCandidatos = await prisma.movimento.findMany({
      where: {
        usuarioId,
        natureza: 'TRANSFERENCIA_PROPRIA',
      },
    });

    const idsParaConverterReceita: string[] = [];

    for (const mov of movimentosCandidatos) {
      if (REGEX_PROVENTOS_SALARIO_PLR.test(mov.descricao)) {
        idsParaConverterReceita.push(mov.id);
      }
    }

    // 2. Inteligência Combinatória (TASK-43):
    // Busca movimentos do usuário onde a categoria NÃO foi fixada manualmente pelo usuário
    // e avalia se o classificador combinatório oferece sugestão refinada de alta confiança.
    const movimentosParaRefinar = await prisma.movimento.findMany({
      where: {
        usuarioId,
        categoriaFixadaPeloUsuario: false,
      },
      select: {
        id: true,
        descricao: true,
        dataMovimento: true,
        valor: true,
        categoriaId: true,
      },
    });

    // Cache local de categorias resolvidas por nome para evitar queries excessivas no loop
    const cacheCategoriasPorNome = new Map<string, string | null>();

    const resolverCategoriaId = async (nomeBusca: string): Promise<string | null> => {
      const chave = nomeBusca.toLowerCase().trim();
      if (cacheCategoriasPorNome.has(chave)) {
        return cacheCategoriasPorNome.get(chave) || null;
      }

      const nomeSemAcento = nomeBusca.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      let cat = await prisma.categoria.findFirst({
        where: {
          OR: [
            { usuarioId, nome: { equals: nomeBusca, mode: 'insensitive' } },
            { usuarioId: null, nome: { equals: nomeBusca, mode: 'insensitive' } },
            { usuarioId, nome: { equals: nomeSemAcento, mode: 'insensitive' } },
            { usuarioId: null, nome: { equals: nomeSemAcento, mode: 'insensitive' } },
          ],
        },
      });

      if (!cat) {
        cat = await prisma.categoria.findFirst({
          where: {
            OR: [
              { usuarioId, nome: { contains: nomeBusca, mode: 'insensitive' } },
              { usuarioId: null, nome: { contains: nomeBusca, mode: 'insensitive' } },
              { usuarioId, nome: { contains: nomeSemAcento, mode: 'insensitive' } },
              { usuarioId: null, nome: { contains: nomeSemAcento, mode: 'insensitive' } },
            ],
          },
        });
      }

      const idEncontrado = cat ? cat.id : null;
      cacheCategoriasPorNome.set(chave, idEncontrado);
      return idEncontrado;
    };

    const atualizacoesCategoria: Array<{ id: string; categoriaId: string }> = [];

    for (const mov of movimentosParaRefinar) {
      const inferencia = classificadorCombinatorioService.inferirCategoria(
        mov.descricao,
        mov.dataMovimento,
        Number(mov.valor)
      );

      if (inferencia && inferencia.confianca >= 0.90) {
        const catId = await resolverCategoriaId(inferencia.categoriaSugerida);
        if (catId && catId !== mov.categoriaId) {
          atualizacoesCategoria.push({ id: mov.id, categoriaId: catId });
        }
      }
    }

    let totalConvertidos = 0;
    let totalCategoriasRefinadas = 0;

    await prisma.$transaction(async (tx) => {
      // Atualiza naturezas de proventos/salário identificados
      if (idsParaConverterReceita.length > 0) {
        const updateResult = await tx.movimento.updateMany({
          where: {
            id: { in: idsParaConverterReceita },
            usuarioId, // Dupla garantia multi-tenant dentro da transação
          },
          data: {
            natureza: 'RECEITA',
          },
        });
        totalConvertidos = updateResult.count;
      }

      // Aplica atualização refinada das categorias combinatórias identificadas
      for (const item of atualizacoesCategoria) {
        await tx.movimento.update({
          where: { id: item.id },
          data: { categoriaId: item.categoriaId },
        });
        totalCategoriasRefinadas++;
      }

      // Atualiza a versão de regras aplicada no cadastro do usuário
      await tx.usuario.update({
        where: { id: usuarioId },
        data: {
          versaoRegrasMovimentos: VERSAO_REGRAS_MOVIMENTOS_ATUAL,
        },
      });
    });

    return {
      usuarioId,
      versaoAnterior,
      versaoAplicada: VERSAO_REGRAS_MOVIMENTOS_ATUAL,
      recalculado: true,
      totalMovimentosAvaliados: movimentosCandidatos.length + movimentosParaRefinar.length,
      totalConvertidosParaReceita: totalConvertidos,
      totalCategoriasRefinadasCombinatorio: totalCategoriasRefinadas,
    };
  }
}
