import { prisma } from '../../../infrastructure/database/prisma.js';
import { BankTransactionRaw } from '../types/bank-connector.interface.js';
import { gerarChaveDedupe } from '../../movimento/movimento.util.js';

export interface IngestItemParams {
  contaId: string;
  transacoes: BankTransactionRaw[];
  origemDocumento?: string;
}

export interface NormalizationPipelineResult {
  totalRecebidas: number;
  novosInseridos: number;
  duplicadasIgnoradas: number;
  pagamentosFaturaConvertidos: number;
  erros: Array<{ index: number; motivo: string }>;
}

/**
 * Pipeline transversal de normalização, deduplicação e garantia de integridade anti-dupla contagem
 * para quaisquer transações bancárias e de extratos.
 */
export class NormalizationPipelineService {
  /**
   * Processa uma lista de transações e persiste no banco respeitando deduplicação e multi-tenant.
   */
  public async processAndIngest(
    usuarioId: string,
    params: IngestItemParams
  ): Promise<NormalizationPipelineResult> {
    const { contaId, transacoes, origemDocumento } = params;

    const result: NormalizationPipelineResult = {
      totalRecebidas: transacoes.length,
      novosInseridos: 0,
      duplicadasIgnoradas: 0,
      pagamentosFaturaConvertidos: 0,
      erros: [],
    };

    // Validar se a conta pertence ao usuário
    const conta = await prisma.conta.findFirst({
      where: { id: contaId, usuarioId },
    });

    if (!conta) {
      throw new Error(`Conta bancária [${contaId}] não pertence ao usuário ou não existe.`);
    }

    for (let i = 0; i < transacoes.length; i++) {
      const tx = transacoes[i];

      try {
        if (!tx.data || isNaN(tx.valor) || tx.valor < 0) {
          result.erros.push({ index: i, motivo: 'Data ou valor inválido.' });
          continue;
        }

        const dataMovimentoDate = new Date(`${tx.data}T00:00:00.000Z`);
        const competencia = tx.data.substring(0, 7);

        // Deduplicação determinística
        const chaveDedupe =
          tx.idExterno ?
            `ext_${tx.idExterno}` :
            gerarChaveDedupe({
              contaId,
              dataMovimento: tx.data,
              valor: tx.valor,
              descricao: tx.descricao,
            });

        // Verificar se já existe no banco
        const existente = await prisma.movimento.findFirst({
          where: {
            usuarioId,
            chaveDedupe,
          },
        });

        if (existente) {
          result.duplicadasIgnoradas++;
          continue;
        }

        // Regra anti-dupla contagem
        let naturezaFinal = tx.natureza;
        if (
          tx.isPagamentoFatura ||
          /pag(amento)?\s*(de)?\s*fat(ura)?|fatura\s*cart[aã]o/i.test(tx.descricao)
        ) {
          naturezaFinal = 'TRANSFERENCIA_PROPRIA';
          result.pagamentosFaturaConvertidos++;
        }

        // Resolução de Categoria POF sugerida pelo conector
        let categoriaId: string | null = null;
        if (tx.categoriaSugerida) {
          const cat = await prisma.categoria.findFirst({
            where: {
              OR: [
                { usuarioId, nome: { equals: tx.categoriaSugerida, mode: 'insensitive' } },
                { usuarioId: null, nome: { equals: tx.categoriaSugerida, mode: 'insensitive' } },
              ],
            },
          });
          if (cat) {
            categoriaId = cat.id;
          }
        }

        await prisma.movimento.create({
          data: {
            usuarioId,
            contaId,
            categoriaId,
            dataMovimento: dataMovimentoDate,
            competencia,
            descricao: tx.descricao,
            valor: tx.valor,
            natureza: naturezaFinal,
            status: 'CONCILIADO',
            chaveDedupe,
            origemDocumento: origemDocumento || 'HUB_OPEN_FINANCE',
            observacao: tx.memo || (tx.idExterno ? `ID Externo: ${tx.idExterno}` : null),
          },
        });

        result.novosInseridos++;
      } catch (err: unknown) {
        result.erros.push({
          index: i,
          motivo: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  }
}
