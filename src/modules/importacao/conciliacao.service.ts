import fs from 'fs';
import path from 'path';
import { prisma } from '../../infrastructure/database/prisma.js';
import { TipoDocumentoImportado, TipoAlertaConciliacao, StatusAlertaConciliacao } from '@prisma/client';
import { inferirTipoDocumentoImportado } from './classificacao-documento.util.js';

export interface CatalogarArquivoInput {
  usuarioId: string;
  arquivoId: string;
  loteId: string;
  contaId?: string;
  periodoInicio?: Date;
  periodoFim?: Date;
}

export interface DispensarAlertaInput {
  usuarioId: string;
  alertaId: string;
  motivoDispensa: string;
}

export class ConciliacaoService {
  /**
   * Cataloga metadados estruturados do arquivo em HistoricoImportacaoArquivo
   * após a consolidação completa de seus lançamentos staging.
   */
  public async catalogarArquivo(input: CatalogarArquivoInput): Promise<any> {
    const { usuarioId, arquivoId, loteId } = input;

    // 1. Busca os lançamentos consolidados vinculados a este arquivo
    const stagings = await prisma.stagingLancamentoImportacao.findMany({
      where: {
        arquivoId,
        statusProcessamento: 'PROCESSADO',
      },
      orderBy: { dataMovimento: 'asc' },
    });

    if (stagings.length === 0) {
      // Se não há lançamentos processados com sucesso, não cria histórico analítico
      return null;
    }

    const arquivo = await prisma.arquivoImportacao.findUnique({
      where: { id: arquivoId },
      include: { lote: true },
    });

    const totalTransacoes = stagings.length;

    // Usa datas explícitas já validadas ou o intervalo dos lançamentos extraídos.
    let periodoInicio: Date = input.periodoInicio || stagings[0].dataMovimento;
    let periodoFim: Date = input.periodoFim || stagings[stagings.length - 1].dataMovimento;
    let dataVencimentoDetectada: Date | null = arquivo?.faturaDataVencimento || null;
    // O tipo é definido pelo padrão predominante. Metadados antigos e sinais
    // isolados (tipoConta/parcela) não podem reclassificar um extrato inteiro.
    const tipoDocumento = inferirTipoDocumentoImportado(stagings) as TipoDocumentoImportado;

    // Determina valorTotal para catálogo e grid de faturas:
    // Para Fatura de Cartão:
    // 1. Prioriza faturaValorTotal oficial gravado no arquivo (declarado no cabeçalho do documento)
    // 2. Caso não presente, calcula a soma líquida das despesas/compras abatendo receitas/estornos e excluindo pagamentos de fatura
    // Para Extratos: soma absoluta tradicional dos lançamentos
    let valorTotal: number;
    if (tipoDocumento === TipoDocumentoImportado.FATURA_CARTAO) {
      if (arquivo?.faturaValorTotal && Number(arquivo.faturaValorTotal) > 0) {
        valorTotal = Number(arquivo.faturaValorTotal);
      } else {
        const comprasEfetivas = stagings.filter(
          (s) =>
            s.natureza !== 'TRANSFERENCIA_PROPRIA' &&
            !/pag(amento)?\s*(de)?\s*(fat(ura)?|fatura)|pgto\s*fat(ura)?|fatura\s*boleto|pagamento\s*recebido/i.test(s.descricao)
        );
        const somaLiquida = comprasEfetivas.reduce((acc, s) => {
          const val = Math.abs(Number(s.valor));
          return s.natureza === 'RECEITA' ? acc - val : acc + val;
        }, 0);
        valorTotal = somaLiquida > 0 ? Number(somaLiquida.toFixed(2)) : stagings.reduce((acc, s) => acc + Math.abs(Number(s.valor)), 0);
      }
    } else {
      valorTotal = stagings.reduce((acc, s) => acc + Math.abs(Number(s.valor)), 0);
    }

    // A instituição só pode vir do contexto estruturado extraído do documento.
    // O nome do arquivo não é evidência confiável e não deve acionar regras por marca.
    const instituicao = stagings[0].contaSugerida
      ?.replace(/^(?:Conta|Cartão)\s+/i, '')
      .trim() || 'Outros';

    // Competência de referência (YYYY-MM baseada na data de vencimento se fatura, ou data final do período)
    const dataRefCompetencia = (tipoDocumento === TipoDocumentoImportado.FATURA_CARTAO && dataVencimentoDetectada)
      ? dataVencimentoDetectada
      : periodoFim;
    const ano = dataRefCompetencia.getUTCFullYear();
    const mes = String(dataRefCompetencia.getUTCMonth() + 1).padStart(2, '0');
    const competencia = `${ano}-${mes}`;

    // Conta vinculada:
    // 1. Usa contaId fornecido diretamente no input
    // 2. Se não fornecido, busca a conta mais frequente nos movimentos criados a partir deste arquivo
    // 3. Caso contrário, busca por identificadores ou pelo nome de conta extraído.
    let contaId: string | null = input.contaId || null;
    if (!contaId) {
      const primeiroStaging = stagings[0];
      if (primeiroStaging.arquivoOrigem) {
        const movExemplo = await prisma.movimento.findFirst({
          where: {
            usuarioId,
            origemDocumento: { contains: primeiroStaging.arquivoOrigem },
          },
          select: { contaId: true },
        });
        if (movExemplo?.contaId) {
          contaId = movExemplo.contaId;
        }
      }

      if (!contaId && primeiroStaging.numeroConta) {
        const numLimpo = primeiroStaging.numeroConta.replace(/\D/g, '');
        const contasUser = await prisma.conta.findMany({ where: { usuarioId } });
        const contaPorNum = contasUser.find((c) => {
          if (!c.numeroConta) return false;
          return c.numeroConta.replace(/\D/g, '') === numLimpo;
        });
        if (contaPorNum) {
          contaId = contaPorNum.id;
        }
      }

      if (!contaId && stagings[0].contaSugerida) {
        const conta = await prisma.conta.findFirst({
          where: {
            usuarioId,
            nome: { contains: stagings[0].contaSugerida, mode: 'insensitive' },
          },
        });
        if (conta) {
          contaId = conta.id;
        }
      }
    }

    // Cria ou atualiza o registro de catálogo (upsert por arquivoId)
    const historico = await prisma.historicoImportacaoArquivo.upsert({
      where: { arquivoId },
      create: {
        usuarioId,
        arquivoId,
        contaId,
        tipoDocumento,
        instituicao,
        competencia,
        dataVencimento: tipoDocumento === TipoDocumentoImportado.FATURA_CARTAO ? dataVencimentoDetectada : null,
        periodoInicio,
        periodoFim,
        totalTransacoes,
        valorTotal,
      },
      update: {
        contaId,
        tipoDocumento,
        instituicao,
        competencia,
        dataVencimento: tipoDocumento === TipoDocumentoImportado.FATURA_CARTAO ? dataVencimentoDetectada : null,
        periodoInicio,
        periodoFim,
        totalTransacoes,
        valorTotal,
      },
    });

    // Dispara checagem e atualização de lacunas para o usuário
    await this.verificarLacunas(usuarioId);

    return historico;
  }

  /**
   * Extrai todas as competências (YYYY-MM) compreendidas em um intervalo de datas.
   */
  private extrairCompetenciasPeriodo(inicio: Date, fim: Date): string[] {
    const res: string[] = [];
    const dt = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), 1));
    const dtFim = new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth(), 1));

    while (dt <= dtFim) {
      const y = dt.getUTCFullYear();
      const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
      res.push(`${y}-${m}`);
      dt.setUTCMonth(dt.getUTCMonth() + 1);
    }

    return res;
  }

  /**
   * Motor de Avaliação de Lacunas Temporais e Auto-Resolução de Alertas.
   * Analisa as contas ativas do usuário marcadas com monitorarConciliacao = true.
   */
  public async verificarLacunas(usuarioId: string): Promise<any> {
    const contas = await prisma.conta.findMany({
      where: {
        usuarioId,
        ativo: true,
        monitorarConciliacao: true,
      },
    });

    for (const conta of contas) {
      // 1. Identifica contas equivalentes/similares (mesmo tipo e banco/raiz do nome)
      // ex.: "Banco Inter" e "Inter", ou contas com mesmo numeroConta
      const raizNome = conta.nome.toLowerCase().replace(/banco|conta|cartão|cartao|\s+/gi, '');
      const contasEquivalentes = contas.filter((c) => {
        if (c.tipo !== conta.tipo) return false;
        if (c.id === conta.id) return true;
        if (c.numeroConta && conta.numeroConta && c.numeroConta.replace(/\D/g, '') === conta.numeroConta.replace(/\D/g, '')) {
          return true;
        }
        const cRaiz = c.nome.toLowerCase().replace(/banco|conta|cartão|cartao|\s+/gi, '');
        return raizNome && cRaiz && (cRaiz.includes(raizNome) || raizNome.includes(cRaiz));
      });
      const contaIdsEquivalentes = contasEquivalentes.map((c) => c.id);

      // 2. Busca históricos associados à conta ou contas equivalentes
      const historicos = await prisma.historicoImportacaoArquivo.findMany({
        where: {
          usuarioId,
          contaId: { in: contaIdsEquivalentes },
        },
        orderBy: { competencia: 'asc' },
      });

      // 3. Extrai conjunto de todas as competências cobertas pelos históricos (abrangendo períodoInicio a periodoFim)
      const competenciasSet = new Set<string>();
      for (const h of historicos) {
        competenciasSet.add(h.competencia);
        if (h.periodoInicio && h.periodoFim) {
          const compsIntervalo = this.extrairCompetenciasPeriodo(h.periodoInicio, h.periodoFim);
          compsIntervalo.forEach((c) => competenciasSet.add(c));
        }
      }

      // Adiciona também todas as competências que já possuem movimentos consolidados na conta ou equivalentes
      const movsConsolidados = await prisma.movimento.groupBy({
        by: ['competencia'],
        where: {
          usuarioId,
          contaId: { in: contaIdsEquivalentes },
        },
      });
      movsConsolidados.forEach((m) => competenciasSet.add(m.competencia));

      // 4. Resolve automaticamente alertas pendentes para competências atendidas
      const alertasPendentes = await prisma.alertaConciliacao.findMany({
        where: {
          usuarioId,
          contaId: conta.id,
          status: StatusAlertaConciliacao.PENDENTE,
        },
      });

      for (const alerta of alertasPendentes) {
        if (competenciasSet.has(alerta.competencia)) {
          await prisma.alertaConciliacao.update({
            where: { id: alerta.id },
            data: {
              status: StatusAlertaConciliacao.RESOLVIDO,
              resolvidoEm: new Date(),
            },
          });
        }
      }

      // Se a conta não tem históricos próprios nem movimentos próprios, e existe outra conta equivalente ativa que já possui os movimentos,
      // inativa o monitoramento da conta sem movimentos para evitar geração de alertas fantasmas.
      const totalMovsProprios = await prisma.movimento.count({
        where: { usuarioId, contaId: conta.id },
      });
      const temOutraComMovimentos = contasEquivalentes.some((c) => c.id !== conta.id);
      if (totalMovsProprios === 0 && temOutraComMovimentos && historicos.length > 0) {
        await prisma.conta.update({
          where: { id: conta.id },
          data: { monitorarConciliacao: false },
        });
        continue;
      }

      if (historicos.length === 0 && competenciasSet.size === 0) continue;

      // 5. Detecção de lacunas cronológicas entre a menor e maior competência
      const comps = Array.from(competenciasSet).sort();
      if (comps.length < 2) continue;

      const compMin = comps[0];
      const compMax = comps[comps.length - 1];

      const [minY, minM] = compMin.split('-').map(Number);
      const [maxY, maxM] = compMax.split('-').map(Number);

      let curY = minY;
      let curM = minM;

      while (curY < maxY || (curY === maxY && curM <= maxM)) {
        const compStr = `${curY}-${String(curM).padStart(2, '0')}`;

        if (!competenciasSet.has(compStr)) {
          // Verifica se já existe alerta dispensado, resolvido ou pendente para este mês
          const alertaExistente = await prisma.alertaConciliacao.findFirst({
            where: {
              usuarioId,
              contaId: { in: contaIdsEquivalentes },
              competencia: compStr,
            },
          });

          if (!alertaExistente) {
            const isCartao = conta.tipo === 'CARTAO_CREDITO';
            const tipoAlerta = isCartao
              ? TipoAlertaConciliacao.FATURA_NAO_IMPORTADA
              : TipoAlertaConciliacao.EXTRATO_LACUNA_TEMPORAL;

            const titulo = isCartao
              ? `Fatura Faltante: ${conta.nome} (${compStr})`
              : `Extrato com Lacuna: ${conta.nome} (${compStr})`;

            const descricao = isCartao
              ? `Não localizamos a fatura do cartão ${conta.nome} para a competência ${compStr}. Foram identificadas faturas anteriores e posteriores.`
              : `Não localizamos o extrato da conta ${conta.nome} para a competência ${compStr}. Existe intervalo temporal descontinuado entre importações.`;

            await prisma.alertaConciliacao.create({
              data: {
                usuarioId,
                contaId: conta.id,
                tipoAlerta,
                titulo,
                descricao,
                competencia: compStr,
                status: StatusAlertaConciliacao.PENDENTE,
              },
            });
          }
        }

        curM++;
        if (curM > 12) {
          curM = 1;
          curY++;
        }
      }
    }

    return this.listarAlertas(usuarioId);
  }

  /**
   * Lista alertas ativos do usuário (PENDENTE por padrão, ou todos)
   */
  public async listarAlertas(usuarioId: string, status?: StatusAlertaConciliacao) {
    return prisma.alertaConciliacao.findMany({
      where: {
        usuarioId,
        ...(status ? { status } : { status: StatusAlertaConciliacao.PENDENTE }),
      },
      include: {
        conta: {
          select: { id: true, nome: true, tipo: true },
        },
      },
      orderBy: { criadoEm: 'desc' },
    });
  }

  /**
   * Dispensa um alerta manualmente com motivo (ex: SEM_GASTOS, CONTA_ENCERRADA, etc.)
   */
  public async dispensarAlerta(input: DispensarAlertaInput) {
    const { usuarioId, alertaId, motivoDispensa } = input;

    const alerta = await prisma.alertaConciliacao.findFirst({
      where: { id: alertaId, usuarioId },
    });

    if (!alerta) {
      throw new Error('Alerta de conciliação não encontrado para este usuário.');
    }

    const atualizado = await prisma.alertaConciliacao.update({
      where: { id: alertaId },
      data: {
        status: StatusAlertaConciliacao.DISPENSADO,
        motivoDispensa,
        resolvidoEm: new Date(),
      },
    });

    // Se o motivo for CONTA_ENCERRADA, desativa o monitoramento para competências futuras da conta
    if (motivoDispensa === 'CONTA_ENCERRADA' && alerta.contaId) {
      await prisma.conta.update({
        where: { id: alerta.contaId },
        data: {
          monitorarConciliacao: false,
          ativo: false,
        },
      });
    }

    return atualizado;
  }

  /**
   * Lista o histórico catalogado de arquivos importados
   */
  public async listarHistoricoArquivos(usuarioId: string) {
    const registros = await prisma.historicoImportacaoArquivo.findMany({
      where: { usuarioId },
      include: {
        arquivo: {
          select: {
            id: true,
            loteId: true,
            nomeArquivo: true,
            status: true,
            statusFinal: true,
            tamanhoBytes: true,
            totalTentativas: true,
            ultimoProvedor: true,
            eFaturaCartao: true,
            faturaDataVencimento: true,
            faturaValorTotal: true,
            criadoEm: true,
          },
        },
        conta: {
          select: { id: true, nome: true, tipo: true },
        },
      },
      orderBy: { criadoEm: 'desc' },
    });

    const arquivoIds = registros.map((r) => r.arquivoId);
    const stagings = arquivoIds.length
      ? await prisma.stagingLancamentoImportacao.findMany({
          where: { arquivoId: { in: arquivoIds }, statusProcessamento: 'PROCESSADO' },
          select: { arquivoId: true, dataMovimento: true, valor: true },
        })
      : [];
    const distPorArquivo = new Map<string, Map<string, { competencia: string; totalTransacoes: number; valorTotal: number }>>();
    for (const s of stagings) {
      const comp = `${s.dataMovimento.getUTCFullYear()}-${String(s.dataMovimento.getUTCMonth() + 1).padStart(2, '0')}`;
      const mapa = distPorArquivo.get(s.arquivoId) || new Map();
      const atual = mapa.get(comp) || { competencia: comp, totalTransacoes: 0, valorTotal: 0 };
      atual.totalTransacoes += 1;
      atual.valorTotal = Number((atual.valorTotal + Math.abs(Number(s.valor))).toFixed(2));
      mapa.set(comp, atual);
      distPorArquivo.set(s.arquivoId, mapa);
    }

    return registros.map((item) => ({
      ...item,
      distribuicaoMensal: Array.from(distPorArquivo.get(item.arquivoId)?.values() || []).sort((a, b) =>
        a.competencia.localeCompare(b.competencia)
      ),
      valorTotal: item.valorTotal ? Number(item.valorTotal) : null,
      arquivo: item.arquivo
        ? {
            ...item.arquivo,
            tamanhoBytes: Number(item.arquivo.tamanhoBytes),
            faturaValorTotal: item.arquivo.faturaValorTotal ? Number(item.arquivo.faturaValorTotal) : null,
          }
        : null,
    }));
  }

  /**
   * Obtém os detalhes consolidados e os lançamentos (movimentos criados ou itens de staging) de um arquivo importado.
   * Garante isolamento estrito por usuarioId.
   */
  public async obterLancamentosArquivo(arquivoId: string, usuarioId: string) {
    const arquivo = await prisma.arquivoImportacao.findFirst({
      where: {
        id: arquivoId,
        lote: { usuarioId },
      },
      include: {
        lote: {
          select: {
            id: true,
            origem: true,
            status: true,
            iaSelecionada: true,
            caminhoDiretorio: true,
            criadoEm: true,
          },
        },
        historico: {
          include: {
            conta: {
              select: { id: true, nome: true, tipo: true },
            },
          },
        },
        tentativas: {
          where: { usuarioId },
          orderBy: { numeroTentativa: 'desc' },
        },
        inventariosIa: {
          where: { usuarioId },
          orderBy: { criadoEm: 'desc' },
          take: 1,
          include: { paginas: { orderBy: { pagina: 'asc' } } },
        },
      },
    });

    if (!arquivo) {
      throw new Error('Arquivo de importação não encontrado ou acesso não autorizado.');
    }

    // 1. Busca os movimentos oficiais gerados a partir deste arquivo
    const movimentos = await prisma.movimento.findMany({
      where: {
        usuarioId,
        origemDocumento: { contains: arquivo.nomeArquivo },
      },
      include: {
        conta: { select: { id: true, nome: true, tipo: true } },
        categoria: { select: { id: true, nome: true } },
      },
      orderBy: { dataMovimento: 'asc' },
    });

    // 2. Busca também os registros na staging para auditoria e conferência detalhada
    const stagingItens = await prisma.stagingLancamentoImportacao.findMany({
      where: {
        arquivoId: arquivo.id,
      },
      orderBy: { dataMovimento: 'asc' },
    });

    return {
      arquivo: {
        id: arquivo.id,
        loteId: arquivo.loteId,
        nomeArquivo: arquivo.nomeArquivo,
        status: arquivo.status,
        statusFinal: arquivo.statusFinal,
        tamanhoBytes: Number(arquivo.tamanhoBytes),
        totalTentativas: arquivo.totalTentativas,
        ultimoProvedor: arquivo.ultimoProvedor,
        eFaturaCartao: arquivo.eFaturaCartao,
        faturaDataVencimento: arquivo.faturaDataVencimento,
        faturaValorTotal: arquivo.faturaValorTotal ? Number(arquivo.faturaValorTotal) : null,
        criadoEm: arquivo.criadoEm,
        lote: arquivo.lote,
        historico: arquivo.historico,
        tentativas: arquivo.tentativas,
      },
      resumo: {
        totalMovimentosOficiais: movimentos.length,
        totalStagingItens: stagingItens.length,
        valorTotalMovimentos: movimentos.reduce((acc, m) => acc + Math.abs(Number(m.valor)), 0),
        somaEntradas: stagingItens.filter((s) => s.natureza === 'RECEITA').reduce((acc, s) => acc + Math.abs(Number(s.valor)), 0),
        somaSaidas: stagingItens.filter((s) => s.natureza !== 'RECEITA').reduce((acc, s) => acc + Math.abs(Number(s.valor)), 0),
      },
      inventarioIa: arquivo.inventariosIa[0] ? {
        paginasTotais: arquivo.inventariosIa[0].paginasTotais,
        paginasComMovimentos: arquivo.inventariosIa[0].paginasComMovimentos,
        registrosPorPagina: arquivo.inventariosIa[0].registrosPorPagina,
        quantidadeEsperada: arquivo.inventariosIa[0].quantidadeEsperada,
        dataInicial: arquivo.inventariosIa[0].dataInicial,
        dataFinal: arquivo.inventariosIa[0].dataFinal,
        somaAbsolutaEsperada: arquivo.inventariosIa[0].somaAbsolutaEsperada ? Number(arquivo.inventariosIa[0].somaAbsolutaEsperada) : null,
        tipoDocumento: arquivo.inventariosIa[0].tipoDocumento,
        confianca: Number(arquivo.inventariosIa[0].confianca),
        observacoes: arquivo.inventariosIa[0].observacoes,
        divergencias: arquivo.inventariosIa[0].divergencias,
        paginas: arquivo.inventariosIa[0].paginas.map((pagina) => ({
          pagina: pagina.pagina, possuiMovimentos: pagina.possuiMovimentos,
          quantidadeEsperada: pagina.quantidadeEsperada, quantidadeExtraida: pagina.quantidadeExtraida,
          somaAbsolutaEsperada: pagina.somaAbsolutaEsperada ? Number(pagina.somaAbsolutaEsperada) : null,
          somaAbsolutaExtraida: pagina.somaAbsolutaExtraida ? Number(pagina.somaAbsolutaExtraida) : null,
          divergencias: pagina.divergencias,
        })),
      } : null,
      movimentos,
      stagingItens,
    };
  }

  /**
   * Exclui a importação de uma fatura e todos os seus lançamentos vinculados,
   * permitindo reimportar o documento sem conflito de duplicação ou resquícios de dados.
   * Remove movimentos oficiais gerados, registros de staging, catálogo histórico e o arquivo físico/banco.
   */
  public async excluirImportacaoFaturaComLancamentos(arquivoId: string, usuarioId: string) {
    const arquivo = await prisma.arquivoImportacao.findFirst({
      where: {
        id: arquivoId,
        lote: { usuarioId },
      },
      include: {
        lote: true,
        historico: true,
      },
    });

    if (!arquivo) {
      throw new Error('Arquivo de fatura não encontrado ou acesso não autorizado.');
    }

    // 1. Identificar movimentos gerados a partir deste arquivo
    const movimentosGerados = await prisma.movimento.findMany({
      where: {
        usuarioId,
        origemDocumento: { contains: arquivo.nomeArquivo },
      },
      select: { id: true },
    });
    const idsMovimentos = movimentosGerados.map((m) => m.id);

    // 2. Transação atômica para limpar movimentos, staging, histórico e o arquivo
    const resultado = await prisma.$transaction(async (tx) => {
      let movimentosExcluidos = 0;

      if (idsMovimentos.length > 0) {
        // Desvincular faturas vinculadas aos movimentos alvo (se algum movimento for pagamento de fatura)
        await tx.arquivoImportacao.updateMany({
          where: { faturaPagamentoMovimentoId: { in: idsMovimentos } },
          data: { faturaPagamentoMovimentoId: null },
        });

        // Desvincular transferências mútuas antes de deletar
        await tx.movimento.updateMany({
          where: { id: { in: idsMovimentos } },
          data: { transferenciaVinculoId: null },
        });

        // Deletar os movimentos (rateios e suspeitas são removidos em cascata por FK onDelete: Cascade)
        const delMovs = await tx.movimento.deleteMany({
          where: { id: { in: idsMovimentos } },
        });
        movimentosExcluidos = delMovs.count;
      }

      // Desvincular se este próprio arquivo de fatura estiver apontando para algum pagamento
      if (arquivo.faturaPagamentoMovimentoId) {
        await tx.arquivoImportacao.update({
          where: { id: arquivoId },
          data: { faturaPagamentoMovimentoId: null },
        });
      }

      // Remover registros em staging vinculados ao arquivo
      const delStaging = await tx.stagingLancamentoImportacao.deleteMany({
        where: { arquivoId },
      });

      // Remover histórico de tentativas do arquivo (TASK-50)
      await tx.tentativaArquivoImportacao.deleteMany({
        where: { arquivoId },
      });

      // Remover catálogo analítico de histórico
      await tx.historicoImportacaoArquivo.deleteMany({
        where: { arquivoId },
      });

      // Remover o registro de arquivoImportacao
      await tx.arquivoImportacao.delete({
        where: { id: arquivoId },
      });

      // Recalcular status e contadores do lote pai
      const loteId = arquivo.loteId;
      const totalRestante = await tx.arquivoImportacao.count({
        where: { loteId },
      });

      const processadosRestantes = await tx.arquivoImportacao.count({
        where: {
          loteId,
          status: { in: ['IA_CONCLUIDO', 'STAGING_CARREGADO', 'PROCESSADO_FINAL'] },
        },
      });

      const errosRestantes = await tx.arquivoImportacao.count({
        where: { loteId, status: 'ERRO' },
      });

      let novoStatusLote = arquivo.lote.status;
      if (totalRestante === 0) {
        novoStatusLote = 'CONCLUIDO';
      } else if (errosRestantes === 0 && (arquivo.lote.status === 'ERRO_PARCIAL' || arquivo.lote.status === 'ERRO_TOTAL')) {
        if (processadosRestantes === totalRestante) {
          novoStatusLote = 'CONCLUIDO';
        } else {
          novoStatusLote = 'PROCESSANDO_IA';
        }
      }

      await tx.loteImportacao.update({
        where: { id: loteId },
        data: {
          totalArquivos: totalRestante,
          arquivosProcessados: processadosRestantes,
          status: novoStatusLote,
        },
      });

      return {
        movimentosExcluidos,
        stagingExcluidos: delStaging.count,
        nomeArquivo: arquivo.nomeArquivo,
      };
    });

    // 3. Remover arquivos físicos no disco (original e consolidado se existirem)
    if (arquivo.lote.caminhoDiretorio) {
      const pastaLote = path.resolve(process.cwd(), arquivo.lote.caminhoDiretorio);
      if (arquivo.caminhoRelativo) {
        const caminhoFisicoOriginal = path.resolve(pastaLote, arquivo.caminhoRelativo);
        try {
          await fs.promises.unlink(caminhoFisicoOriginal);
        } catch {
          // Arquivo pode já ter sido excluído ou não existir
        }
      }

      const caminhoConsolidado = path.resolve(pastaLote, `consolidado_${arquivo.id}.json`);
      try {
        await fs.promises.unlink(caminhoConsolidado);
      } catch {
        // Ignora caso não exista
      }
    }

    // 4. Reavalia lacunas de conciliação do usuário
    try {
      await this.verificarLacunas(usuarioId);
    } catch (errLacunas) {
      console.warn('[ConciliacaoService] Aviso ao verificar lacunas após exclusão:', errLacunas);
    }

    return {
      sucesso: true,
      arquivoId,
      nomeArquivo: resultado.nomeArquivo,
      movimentosExcluidos: resultado.movimentosExcluidos,
      stagingExcluidos: resultado.stagingExcluidos,
    };
  }
}

export const conciliacaoService = new ConciliacaoService();
