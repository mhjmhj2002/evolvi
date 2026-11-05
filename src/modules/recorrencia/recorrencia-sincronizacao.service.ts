import { PrismaClient, Recorrencia } from '@prisma/client';
import { prisma as defaultPrisma } from '../../infrastructure/database/prisma.js';
import { configuracaoService } from '../usuario/configuracao.service.js';
import { calcularUltimosMesesFechados } from '../fase1/baseline.service.js';
import { extrairRaizComerciante, extrairInfoParcelamento } from '../movimento/movimento.util.js';

export interface SincronizacaoRecorrenciaResultado {
  usuarioId: string;
  totalAvaliados: number;
  totalCriados: number;
  totalAtualizados: number;
  totalAtivos: number;
}

export interface CandidatoRecorrencia {
  descricao: string;
  categoriaId?: string | null;
  valorReferencia: number;
  diaPrevisto?: number | null;
  formaPagamento?: string | null;
  essencial: boolean;
  origemMotivo: string;
}

export class RecorrenciaSincronizacaoService {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient = defaultPrisma) {
    this.prisma = prismaClient;
  }

  private normalizarTexto(texto: string): string {
    return (texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  /**
   * Identifica palavras-chave inequívocas de contratos e despesas recorrentes estruturais
   */
  public ehContratoRecorrente(desc: string): boolean {
    const norm = this.normalizarTexto(desc);
    return (
      norm.includes('condominio') ||
      norm.includes('edificio') ||
      norm.includes('aluguel') ||
      norm.includes('habitacional') ||
      norm.includes('financiamento') ||
      norm.includes('credito imobiliario') ||
      norm.includes('prest cr im') ||
      norm.includes('energia') ||
      norm.includes('eletrica') ||
      norm.includes('edp') ||
      norm.includes('enel') ||
      norm.includes('copel') ||
      norm.includes('cemig') ||
      norm.includes('claro') ||
      norm.includes('vivo') ||
      /(?:^|[\s*_-])tim(?:$|[\s*_-])/.test(norm) ||
      norm.includes('internet') ||
      norm.includes('fibra') ||
      norm.includes('escola') ||
      norm.includes('colegio') ||
      norm.includes('faculdade') ||
      norm.includes('professores') ||
      norm.includes('uniao de professores') ||
      norm.includes('mensalidade') ||
      norm.includes('seguro') ||
      norm.includes('plano de saude') ||
      norm.includes('unimed') ||
      norm.includes('amil') ||
      norm.includes('bradesco saude') ||
      norm.includes('sulamerica') ||
      norm.includes('academia') ||
      norm.includes('smart fit') ||
      norm.includes('bluefit') ||
      norm.includes('netflix') ||
      norm.includes('spotify') ||
      norm.includes('amazon prime') ||
      norm.includes('disney') ||
      norm.includes('hbo') ||
      norm.includes('max') ||
      norm.includes('openai') ||
      norm.includes('chatgpt') ||
      norm.includes('google one') ||
      norm.includes('youtube') ||
      norm.includes('apple.com') ||
      norm.includes('icloud')
    );
  }

  /**
   * Normaliza descrições para nomes amigáveis e canônicos de compromissos recorrentes
   */
  public normalizarNomeRecorrente(desc: string): string {
    const norm = this.normalizarTexto(desc);

    if (norm.includes('edp')) return 'Energia Elétrica (EDP)';
    if (norm.includes('enel')) return 'Energia Elétrica (Enel)';
    if (norm.includes('copel')) return 'Energia Elétrica (Copel)';
    if (norm.includes('cemig')) return 'Energia Elétrica (Cemig)';
    if (norm.includes('claro')) return 'Telecomunicações / Internet (Claro)';
    if (norm.includes('vivo')) return 'Telecomunicações / Internet (Vivo)';
    if (/(?:^|[\s*_-])tim(?:$|[\s*_-])/.test(norm)) return 'Telecomunicações (TIM)';
    if (norm.includes('fibra') || norm.includes('loga')) return 'Internet Fibra';
    if (norm.includes('condominio') || norm.includes('altair')) {
      if (norm.includes('altair')) return 'Condomínio Edifício Altair';
      return 'Condomínio Residencial';
    }
    if (norm.includes('credito imobiliario') || norm.includes('prest cr im') || norm.includes('financiamento')) {
      return 'Financiamento Imobiliário';
    }
    if (norm.includes('uniao de professores') || (norm.includes('mensalidade') && norm.includes('professores'))) {
      return 'Mensalidade Escolar';
    }
    if (norm.includes('seguro casa') || norm.includes('seguro residencial')) return 'Seguro Residencial';
    if (norm.includes('seguro')) return 'Seguro';
    if (norm.includes('netflix')) return 'Netflix';
    if (norm.includes('spotify')) return 'Spotify';
    if (norm.includes('chatgpt') || norm.includes('openai')) return 'ChatGPT / OpenAI';
    if (norm.includes('google one')) return 'Google One';
    if (norm.includes('hbo') || norm.includes('max')) return 'HBO Max';
    if (norm.includes('disney')) return 'Disney+';

    // Fallback: extrai raiz do comerciante ou descrição limpa
    const raiz = extrairRaizComerciante(desc);
    return (raiz || desc).trim();
  }

  /**
   * Sincroniza e detecta gastos recorrentes do usuário a partir dos movimentos bancários e de cartão.
   * Regras aplicadas:
   * 1. Contratos Estruturais: Palavras-chave claras (Condomínio, Energia, Mensalidade, Internet, Seguro, etc.)
   * 2. Repetição Temporal: Despesas que ocorrem em 2 ou mais competências distintas na janela temporal
   * 3. Idempotência: Se o usuário já cadastrou manualmente um compromisso similar, mantém o do usuário
   */
  public async sincronizarParaUsuario(
    usuarioId: string,
    competenciaRef?: string
  ): Promise<SincronizacaoRecorrenciaResultado> {
    const mesesConfig = await configuracaoService.obterMesesJanelaUsuario(usuarioId);
    const nMeses = Math.max(mesesConfig, 6);

    let compAtual = competenciaRef;
    if (!compAtual) {
      const agora = new Date();
      compAtual = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
    }

    // Janela temporal completa: meses fechados + mês corrente
    const mesesHistoricos = calcularUltimosMesesFechados(compAtual, nMeses);
    const janelaCompleta = Array.from(new Set([compAtual, ...mesesHistoricos]));

    // 1. Carregar compromissos recorrentes já existentes no banco
    const recorrenciasExistentes = await this.prisma.recorrencia.findMany({
      where: { usuarioId },
    });

    // 2. Carregar todos os movimentos de despesa da janela temporal
    const movimentos = await this.prisma.movimento.findMany({
      where: {
        usuarioId,
        natureza: 'DESPESA',
        competencia: { in: janelaCompleta },
      },
      include: {
        categoria: { select: { id: true, nome: true } },
      },
      orderBy: { dataMovimento: 'desc' },
    });

    // Agrupamento por chave normalizada e raiz de comerciante
    const grupos = new Map<string, typeof movimentos>();

    for (const mov of movimentos) {
      // Ignora encargos e tarifas avulsas (ex: IOF) que não são compromissos de consumo/contratos
      const descUpper = mov.descricao.toUpperCase();
      if (descUpper === 'IOF' || descUpper.startsWith('IOF ') || descUpper.endsWith(' IOF')) {
        continue;
      }

      // Ignora parcelas de compras pontuais com poucas parcelas
      const infoParc = extrairInfoParcelamento(mov.descricao);
      if (infoParc && infoParc.totalParcelas > 1 && infoParc.totalParcelas <= 12) {
        // Compras parceladas comuns não são gastos recorrentes sem fim (ficam em Parcelamento)
        continue;
      }

      const ehContrato = this.ehContratoRecorrente(mov.descricao);
      const chaveNome = this.normalizarNomeRecorrente(mov.descricao);
      const raizComerciante = extrairRaizComerciante(mov.descricao);
      const chaveNorm = this.normalizarTexto(chaveNome || raizComerciante || mov.descricao);

      if (!grupos.has(chaveNorm)) {
        grupos.set(chaveNorm, []);
      }
      grupos.get(chaveNorm)!.push(mov);
    }

    const candidatos: CandidatoRecorrencia[] = [];

    for (const [chaveNorm, lista] of grupos.entries()) {
      const primeiro = lista[0];
      const ehContrato = this.ehContratoRecorrente(primeiro.descricao);
      const competenciasDistintas = new Set(lista.map((m) => m.competencia));

      // Regra 1: Um lançamento por mês só (caso da feira e padaria têm múltiplos lançamentos em um mesmo mês)
      // Para despesas do dia a dia (não contratos), qualquer mês com múltiplos lançamentos desqualifica como gasto fixo/recorrente mensal.
      const contagemPorComp = new Map<string, number>();
      for (const m of lista) {
        contagemPorComp.set(m.competencia, (contagemPorComp.get(m.competencia) || 0) + 1);
      }
      const temMesComMaisDeUmLancamento = Array.from(contagemPorComp.values()).some((qtd) => qtd > 1);
      if (!ehContrato && temMesComMaisDeUmLancamento) {
        continue;
      }

      // Regra 2: Pelo menos 2 meses seguidos (consecutivos)
      const compsOrdenadas = Array.from(competenciasDistintas).sort();
      let temDoisMesesSeguidos = false;

      for (let i = 0; i < compsOrdenadas.length - 1; i++) {
        const c1 = compsOrdenadas[i];
        const c2 = compsOrdenadas[i + 1];
        const [ano1, mes1] = c1.split('-').map(Number);
        const [ano2, mes2] = c2.split('-').map(Number);
        const diffMeses = (ano2 * 12 + mes2) - (ano1 * 12 + mes1);
        if (diffMeses === 1) {
          temDoisMesesSeguidos = true;
          break;
        }
      }

      if (!temDoisMesesSeguidos) {
        continue;
      }

      // Regra 3: Valores muito semelhantes entre os meses
      // Não-contratos exigem variação estrita (<= 25%). Contratos de concessionárias toleram variação de consumo (ex: luz/água).
      if (!ehContrato) {
        const valores = lista.map((m) => Number(m.valor));
        const minValor = Math.min(...valores);
        const maxValor = Math.max(...valores);
        const variacaoValor = minValor > 0 ? (maxValor - minValor) / minValor : 0;
        if (variacaoValor > 0.25) {
          continue;
        }
      }

      // Regra 4: Praticamente na mesma data (dias do mês muito próximos, máx 6 dias de diferença)
      // Não-contratos exigem data fixa (<= 6 dias de diferença). Contratos toleram vencimento/fim de semana.
      if (!ehContrato) {
        const diasDoMes = lista
          .map((m) => (m.dataMovimento ? m.dataMovimento.getUTCDate() : null))
          .filter((d): d is number => d !== null);

        if (diasDoMes.length >= 2) {
          const minDia = Math.min(...diasDoMes);
          const maxDia = Math.max(...diasDoMes);
          const difDias = maxDia - minDia;
          if (difDias > 6) {
            continue;
          }
        }
      }

      // Calcula valor de referência:
      // Agrupa por competência para obter o total do mês e tira a média dos meses com lançamento
      const porComp = new Map<string, number>();
      for (const m of lista) {
        porComp.set(m.competencia, (porComp.get(m.competencia) || 0) + Number(m.valor));
      }

      const totalValores = Array.from(porComp.values()).reduce((a, b) => a + b, 0);
      const mesesComGasto = porComp.size;
      const mediaMensal = mesesComGasto > 0 ? totalValores / mesesComGasto : Number(primeiro.valor);

      // Extrai dia do mês preferencial em UTC (compatível com timestamptz/date)
      const diaVencimento = primeiro.dataMovimento ? primeiro.dataMovimento.getUTCDate() : null;

      // Forma de pagamento detectada
      let formaPagamento: string | null = null;
      const descUpper = primeiro.descricao.toUpperCase();
      if (descUpper.includes('BOLETO')) formaPagamento = 'Boleto';
      else if (descUpper.includes('DA ') || descUpper.includes('DEBITO')) formaPagamento = 'Débito Automático';
      else if (descUpper.includes('PIX')) formaPagamento = 'PIX';
      else formaPagamento = 'Cartão';

      const nomeAmigavel = this.normalizarNomeRecorrente(primeiro.descricao);

      candidatos.push({
        descricao: nomeAmigavel,
        categoriaId: primeiro.categoriaId || null,
        valorReferencia: Number(mediaMensal.toFixed(2)),
        diaPrevisto: diaVencimento,
        formaPagamento,
        essencial: ehContrato, // Contratos de moradia/serviços essenciais recebem true
        origemMotivo: `Gasto recorrente identificado (${mesesComGasto} meses com pelo menos 2 consecutivos)`,
      });
    }

    let criados = 0;
    let atualizados = 0;
    let removidos = 0;

    for (const cand of candidatos) {
      const candNorm = this.normalizarTexto(cand.descricao);

      // Procura se já existe recorrência cadastrada com nome ou descrição parecida
      const existente = recorrenciasExistentes.find((r) => {
        const rNorm = this.normalizarTexto(r.descricao);
        return rNorm === candNorm || rNorm.includes(candNorm) || candNorm.includes(rNorm);
      });

      if (!existente) {
        await this.prisma.recorrencia.create({
          data: {
            usuarioId,
            categoriaId: cand.categoriaId ?? null,
            descricao: cand.descricao,
            valorReferencia: cand.valorReferencia,
            diaPrevisto: cand.diaPrevisto ?? null,
            formaPagamento: cand.formaPagamento ?? null,
            essencial: cand.essencial,
            status: 'ATIVA',
          },
        });
        criados++;
      } else {
        // Se a recorrência foi CANCELADA pelo usuário, respeita a decisão de exclusão e não reativa nem recria
        if (existente.status === 'CANCELADA') {
          continue;
        }

        // Se a recorrência já existe e está ativa, preservamos as decisões do usuário,
        // atualizando apenas se não tiver dia previsto ou se o valor estava zerado.
        if (!existente.diaPrevisto && cand.diaPrevisto) {
          await this.prisma.recorrencia.update({
            where: { id: existente.id },
            data: { diaPrevisto: cand.diaPrevisto },
          });
          atualizados++;
        }
      }
    }

    // 4. Limpeza de recorrências automáticas obsoletas:
    // Se uma recorrência existente no banco não é um contrato estrutural, não foi aprovada
    // na lista de candidatos válidos da janela temporal e possui movimentos associados que violam
    // as regras estritas (ex: compras em padaria, feira, comércio com múltiplos lançamentos por mês),
    // remove-a para não poluir os compromissos recorrentes do usuário.
    for (const ext of recorrenciasExistentes) {
      const extNorm = this.normalizarTexto(ext.descricao);
      const ehContrato = this.ehContratoRecorrente(ext.descricao);

      if (ehContrato) {
        continue;
      }

      const aprovadoComoCandidato = candidatos.some((cand) => {
        const candNorm = this.normalizarTexto(cand.descricao);
        return candNorm === extNorm || extNorm.includes(candNorm) || candNorm.includes(extNorm);
      });

      if (!aprovadoComoCandidato) {
        // Verifica se essa recorrência provém de movimentos que não atendem às regras estritas
        const raiz = extrairRaizComerciante(ext.descricao);
        const movsRelacionados = movimentos.filter((m) => {
          const mNorm = this.normalizarTexto(m.descricao);
          const mRaiz = this.normalizarTexto(extrairRaizComerciante(m.descricao) || '');
          return (
            mNorm.includes(extNorm) ||
            extNorm.includes(mNorm) ||
            (raiz && mRaiz && (mRaiz.includes(raiz.toLowerCase()) || raiz.toLowerCase().includes(mRaiz)))
          );
        });

        // Se tem movimentos associados, checamos se viola as regras de recorrência:
        if (movsRelacionados.length > 0) {
          const contagem = new Map<string, number>();
          for (const m of movsRelacionados) {
            contagem.set(m.competencia, (contagem.get(m.competencia) || 0) + 1);
          }
          const temMaisDeUmNoMes = Array.from(contagem.values()).some((qtd) => qtd > 1);

          // Verifica variação de valor e proximidade de datas
          const valores = movsRelacionados.map((m) => Number(m.valor));
          const minVal = Math.min(...valores);
          const maxVal = Math.max(...valores);
          const variacaoValor = minVal > 0 ? (maxVal - minVal) / minVal : 0;

          const dias = movsRelacionados
            .map((m) => (m.dataMovimento ? m.dataMovimento.getUTCDate() : null))
            .filter((d): d is number => d !== null);
          const difDias = dias.length >= 2 ? Math.max(...dias) - Math.min(...dias) : 0;

          // Se tem mais de 1 no mês (feira/padaria), ou variação alta, ou dias distantes, ou menos de 2 lançamentos:
          if (temMaisDeUmNoMes || variacaoValor > 0.25 || difDias > 6 || movsRelacionados.length < 2) {
            await this.prisma.recorrencia.delete({
              where: { id: ext.id },
            });
            removidos++;
          }
        } else {
          // Se não há nenhum movimento associado a esta recorrência na janela e ela não foi aprovada como candidato
          await this.prisma.recorrencia.delete({
            where: { id: ext.id },
          });
          removidos++;
        }
      }
    }

    const totalAtivos = await this.prisma.recorrencia.count({
      where: { usuarioId, status: 'ATIVA' },
    });

    return {
      usuarioId,
      totalAvaliados: candidatos.length,
      totalCriados: criados,
      totalAtualizados: atualizados,
      totalAtivos,
    };
  }
}

export const recorrenciaSincronizacaoService = new RecorrenciaSincronizacaoService();
