import fs from 'fs';
import path from 'path';
import { prisma } from '../../infrastructure/database/prisma.js';
import { TipoDocumentoImportado, TipoAlertaConciliacao, StatusAlertaConciliacao } from '@prisma/client';
import { PdfTextExtractor } from '../conector/parsers/pdf-text-extractor.js';

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

const MESES_MAP: Record<string, number> = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, março: 3, mar: 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
};

export class ConciliacaoService {
  /**
   * Extrai o período coberto formalmente pelo documento a partir de cabeçalhos
   * de texto (PDF/OFX/CSV) ou nomenclatura do arquivo (ex.: Extrato_Neon_2025-12_a_2026-09.pdf).
   */
  public extrairPeriodoDocumento(
    texto?: string | null,
    nomeArquivo?: string | null
  ): { inicio: Date; fim: Date } | null {
    const fontes = [texto, nomeArquivo].filter(Boolean) as string[];

    for (const fonte of fontes) {
      // 1. "Período de 31/12/2025 a 16/09/2026" ou "01/01/2026 até 30/06/2026"
      const r1 = /(?:per[íi]odo[^\d\n\r]{0,35}|de\s+)?(\d{2})[\/\-](\d{2})[\/\-](\d{4})\s*(?:a|at[ée]|-)\s*(\d{2})[\/\-](\d{2})[\/\-](\d{4})/i;
      const m1 = fonte.match(r1);
      if (m1) {
        return {
          inicio: new Date(Date.UTC(+m1[3], +m1[2] - 1, +m1[1])),
          fim: new Date(Date.UTC(+m1[6], +m1[5] - 1, +m1[4])),
        };
      }

      // 2. "16 de setembro de 2025 até 16 de setembro de 2026"
      const r2 = /(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})\s*(?:a|at[ée]|-)\s*(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i;
      const m2 = fonte.match(r2);
      if (m2) {
        const mes1 = MESES_MAP[m2[2].toLowerCase()];
        const mes2 = MESES_MAP[m2[5].toLowerCase()];
        if (mes1 && mes2) {
          return {
            inicio: new Date(Date.UTC(+m2[3], mes1 - 1, +m2[1])),
            fim: new Date(Date.UTC(+m2[6], mes2 - 1, +m2[4])),
          };
        }
      }

      // 3. "YYYY-MM a YYYY-MM" ou "YYYY-MM_a_YYYY-MM" (ex: Extrato_Neon_2025-12_a_2026-09.pdf)
      const r3 = /(\d{4})-(\d{2})\s*(?:a|at[ée]|_a_|-)\s*(\d{4})-(\d{2})/i;
      const m3 = fonte.match(r3);
      if (m3) {
        return {
          inicio: new Date(Date.UTC(+m3[1], +m3[2] - 1, 1)),
          fim: new Date(Date.UTC(+m3[3], +m3[4], 0)),
        };
      }

      // 4. "DD-MM-YYYY a DD-MM-YYYY" (ex: Extrato-19-08-2026-a-19-09-2026-CSV.csv)
      const r4 = /(\d{2})[-_](\d{2})[-_](\d{4})[-_ ]*(?:a|at[ée]|_a_)[-_ ]*(\d{2})[-_](\d{2})[-_](\d{4})/i;
      const m4 = fonte.match(r4);
      if (m4) {
        return {
          inicio: new Date(Date.UTC(+m4[3], +m4[2] - 1, +m4[1])),
          fim: new Date(Date.UTC(+m4[6], +m4[5] - 1, +m4[4])),
        };
      }

      // 5. "01JUN2026_30JUN2026" (Nubank CSV)
      const r5 = /(\d{2})([A-Z]{3})(\d{4})_(\d{2})([A-Z]{3})(\d{4})/i;
      const m5 = fonte.match(r5);
      if (m5) {
        const mes1 = MESES_MAP[m5[2].toLowerCase()];
        const mes2 = MESES_MAP[m5[5].toLowerCase()];
        if (mes1 && mes2) {
          return {
            inicio: new Date(Date.UTC(+m5[3], mes1 - 1, +m5[1])),
            fim: new Date(Date.UTC(+m5[6], mes2 - 1, +m5[4])),
          };
        }
      }
    }

    return null;
  }

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
    });

    const nomeArquivo = arquivo?.nomeArquivo || '';
    const totalTransacoes = stagings.length;

    // Determina o período do extrato:
    // Prioridade 1: Período explícito fornecido no input
    // Prioridade 2: Período extraído do arquivo físico (PDF/OFX/CSV) ou de seu nome
    // Prioridade 3: Menor e maior dataMovimento dos lançamentos staging
    let periodoInicio: Date = input.periodoInicio || stagings[0].dataMovimento;
    let periodoFim: Date = input.periodoFim || stagings[stagings.length - 1].dataMovimento;

    if (!input.periodoInicio || !input.periodoFim) {
      let textoArquivo: string | null = null;
      if (arquivo?.caminhoRelativo && fs.existsSync(arquivo.caminhoRelativo)) {
        try {
          if (arquivo.caminhoRelativo.toLowerCase().endsWith('.pdf')) {
            const buf = fs.readFileSync(arquivo.caminhoRelativo);
            textoArquivo = PdfTextExtractor.extrairTexto(buf);
          } else {
            textoArquivo = fs.readFileSync(arquivo.caminhoRelativo, 'utf-8').slice(0, 5000);
          }
        } catch {
          // Fallback silencioso para nomenclatura ou datas dos stagings
        }
      }

      const periodoDetectado = this.extrairPeriodoDocumento(textoArquivo, nomeArquivo);
      if (periodoDetectado) {
        if (!input.periodoInicio) periodoInicio = periodoDetectado.inicio;
        if (!input.periodoFim) periodoFim = periodoDetectado.fim;
      }
    }

    // Soma valores absolutos para valorTotal
    const valorTotal = stagings.reduce((acc, s) => acc + Math.abs(Number(s.valor)), 0);

    // Heurística de TipoDocumento e Instituição
    let tipoDocumento: TipoDocumentoImportado = TipoDocumentoImportado.OUTRO;
    const nomeLower = (nomeArquivo + ' ' + (stagings[0].contaSugerida || '')).toLowerCase();

    if (
      nomeLower.includes('fatura') ||
      nomeLower.includes('card') ||
      nomeLower.includes('cartao') ||
      nomeLower.includes('credit')
    ) {
      tipoDocumento = TipoDocumentoImportado.FATURA_CARTAO;
    } else if (
      nomeLower.includes('invest') ||
      nomeLower.includes('cdb') ||
      nomeLower.includes('renda fixa')
    ) {
      tipoDocumento = TipoDocumentoImportado.EXTRATO_INVESTIMENTO;
    } else if (
      nomeLower.includes('extrato') ||
      nomeLower.includes('conta') ||
      nomeLower.includes('statement')
    ) {
      tipoDocumento = TipoDocumentoImportado.EXTRATO_CONTA_CORRENTE;
    }

    // Instituição
    let instituicao = 'Outros';
    if (nomeLower.includes('nubank')) instituicao = 'Nubank';
    else if (nomeLower.includes('c6')) instituicao = 'C6 Bank';
    else if (nomeLower.includes('inter')) instituicao = 'Banco Inter';
    else if (nomeLower.includes('itau')) instituicao = 'Itaú';
    else if (nomeLower.includes('santander')) instituicao = 'Santander';
    else if (nomeLower.includes('pagbank') || nomeLower.includes('pagseguro')) instituicao = 'PagBank';
    else if (nomeLower.includes('mercado pago')) instituicao = 'Mercado Pago';
    else if (stagings[0].contaSugerida) {
      instituicao = stagings[0].contaSugerida.replace(/Conta\s+|Cartão\s+/gi, '').trim() || 'Outros';
    }

    // Competência de referência (YYYY-MM baseada na data final do período)
    const ano = periodoFim.getUTCFullYear();
    const mes = String(periodoFim.getUTCMonth() + 1).padStart(2, '0');
    const competencia = `${ano}-${mes}`;

    // Conta vinculada:
    // 1. Usa contaId fornecido diretamente no input
    // 2. Se não fornecido, busca a conta mais frequente nos movimentos criados a partir deste arquivo
    // 3. Caso contrário, busca por identificadores (numeroConta / digitosCartao) ou correspondência com o nome da instituição
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

      if (!contaId) {
        const conta = await prisma.conta.findFirst({
          where: {
            usuarioId,
            nome: { contains: instituicao, mode: 'insensitive' },
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
        dataVencimento: tipoDocumento === TipoDocumentoImportado.FATURA_CARTAO ? periodoFim : null,
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
        dataVencimento: tipoDocumento === TipoDocumentoImportado.FATURA_CARTAO ? periodoFim : null,
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

      // Extrai períodos de extratos formalmente cobertos presentes em origemDocumento dos movimentos
      const origensDocumento = await prisma.movimento.findMany({
        where: {
          usuarioId,
          contaId: { in: contaIdsEquivalentes },
          origemDocumento: { not: null },
        },
        select: { origemDocumento: true },
        distinct: ['origemDocumento'],
      });

      for (const item of origensDocumento) {
        if (!item.origemDocumento) continue;
        const periodoOrigem = this.extrairPeriodoDocumento(null, item.origemDocumento);
        if (periodoOrigem) {
          const compsIntervalo = this.extrairCompetenciasPeriodo(
            periodoOrigem.inicio,
            periodoOrigem.fim
          );
          compsIntervalo.forEach((c) => competenciasSet.add(c));
        }
      }

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

    return registros.map((item) => ({
      ...item,
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
      },
      movimentos,
      stagingItens,
    };
  }
}

export const conciliacaoService = new ConciliacaoService();
