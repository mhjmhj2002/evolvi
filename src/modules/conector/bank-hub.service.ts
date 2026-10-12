import { prisma } from '../../infrastructure/database/prisma.js';
import { configuracaoService } from '../usuario/configuracao.service.js';
import { BankConnectorFactory } from './factory/bank-connector.factory.js';
import { UniversalStatementParser, ParseResult } from './parsers/universal-statement.parser.js';
import { NormalizationPipelineService, NormalizationPipelineResult } from './pipeline/normalization-pipeline.service.js';
import { BankAccountRaw } from './types/bank-connector.interface.js';

export class BankHubService {
  private parser = new UniversalStatementParser();
  private pipeline = new NormalizationPipelineService();

  /**
   * Lista todas as instituições bancárias suportadas pelo Hub
   */
  public listInstitutions() {
    return BankConnectorFactory.listSupportedInstitutions();
  }

  /**
   * Lista conexões bancárias salvas do usuário
   */
  public async listUserConnections(usuarioId: string) {
    return prisma.conexaoBancaria.findMany({
      where: { usuarioId },
      orderBy: { criadoEm: 'desc' },
    });
  }

  /**
   * Conecta ou autoriza uma nova instituição bancária para o usuário
   */
  public async connectInstitution(params: {
    usuarioId: string;
    instituicaoCodigo: string;
    credentials?: Record<string, unknown>;
  }) {
    const { usuarioId, instituicaoCodigo, credentials } = params;

    const provider = BankConnectorFactory.getProvider(instituicaoCodigo);
    const authResult = await provider.authenticate(credentials);

    const conexao = await prisma.conexaoBancaria.create({
      data: {
        usuarioId,
        instituicaoCodigo: provider.codigo,
        instituicaoNome: provider.nome,
        compe: provider.compe || null,
        status: authResult.sucesso ? 'CONECTADO' : 'ERRO_AUTENTICACAO',
        consentimentoId: authResult.consentimentoId,
        consentimentoExpiraEm: authResult.expiraEm,
        ultimaSincronizacaoEm: new Date(),
        parametrosExtras: credentials ? JSON.stringify(credentials) : null,
      },
    });

    return {
      conexao,
      authResult,
    };
  }

  /**
   * Sincroniza uma conexão bancária existente (busca contas e transações recentes)
   */
  public async syncConnection(params: {
    usuarioId: string;
    conexaoId: string;
    dataInicio?: string;
    dataFim?: string;
  }) {
    const { usuarioId, conexaoId } = params;

    const conexao = await prisma.conexaoBancaria.findFirst({
      where: { id: conexaoId, usuarioId },
    });

    if (!conexao) {
      throw new Error('Conexão bancária não encontrada.');
    }

    if (!conexao.consentimentoId) {
      throw new Error('Conexão sem consentimento ativo.');
    }

    const provider = BankConnectorFactory.getProvider(conexao.instituicaoCodigo);

    // 1. Obter contas remotas do conector
    const rawAccounts: BankAccountRaw[] = await provider.listAccounts(conexao.consentimentoId);

    const hoje = new Date().toISOString().split('T')[0];
    const mesesJanela = await configuracaoService.obterMesesJanelaUsuario(usuarioId);

    // Calcular primeiro dia da janela retroativa de N meses caso dataInicio não informada
    let dataInicioCalculada: string;
    if (params.dataInicio) {
      dataInicioCalculada = params.dataInicio;
    } else {
      const dataRetro = new Date();
      dataRetro.setMonth(dataRetro.getMonth() - (mesesJanela - 1));
      const anoRetro = dataRetro.getFullYear();
      const mesRetro = String(dataRetro.getMonth() + 1).padStart(2, '0');
      dataInicioCalculada = `${anoRetro}-${mesRetro}-01`;
    }

    const dataInicio = dataInicioCalculada;
    const dataFim = params.dataFim || hoje;

    let totalInseridos = 0;
    let totalDedupeIgnorados = 0;
    const contasMapeadas: Array<{ contaNome: string; inseridos: number; ignorados: number }> = [];

    for (const rawAcc of rawAccounts) {
      // Localizar ou provisionar conta local correspondente
      let contaLocal = await prisma.conta.findFirst({
        where: {
          usuarioId,
          nome: rawAcc.nome,
        },
      });

      if (!contaLocal) {
        contaLocal = await prisma.conta.create({
          data: {
            usuarioId,
            nome: rawAcc.nome,
            tipo: rawAcc.tipo,
            saldoInicial: rawAcc.saldoAtual ?? 0,
            diaFechamento: rawAcc.diaFechamento ?? null,
            diaVencimento: rawAcc.diaVencimento ?? null,
          },
        });
      }

      // Buscar transações de extrato
      let transacoes = await provider.fetchTransactions({
        consentimentoId: conexao.consentimentoId,
        contaIdExterno: rawAcc.idExterno,
        dataInicio,
        dataFim,
      });

      // Se for cartão de crédito, buscar faturas e seus lançamentos detalhados
      if (rawAcc.tipo === 'CARTAO_CREDITO') {
        const competenciaAtual = dataFim.substring(0, 7);
        const faturas = await provider.fetchCreditCardInvoices({
          consentimentoId: conexao.consentimentoId,
          cartaoIdExterno: rawAcc.idExterno,
          competencia: competenciaAtual,
        });

        for (const fatura of faturas) {
          if (fatura.lancamentos && fatura.lancamentos.length > 0) {
            transacoes = [...transacoes, ...fatura.lancamentos];
          }
        }
      }

      // Pipeline de normalização e anti-dupla contagem
      const pipeRes = await this.pipeline.processAndIngest(usuarioId, {
        contaId: contaLocal.id,
        transacoes,
        origemDocumento: `SYNC_${provider.codigo}`,
      });

      totalInseridos += pipeRes.novosInseridos;
      totalDedupeIgnorados += pipeRes.duplicadasIgnoradas;
      contasMapeadas.push({
        contaNome: contaLocal.nome,
        inseridos: pipeRes.novosInseridos,
        ignorados: pipeRes.duplicadasIgnoradas,
      });
    }

    // Atualiza timestamp da conexão
    await prisma.conexaoBancaria.update({
      where: { id: conexaoId },
      data: {
        ultimaSincronizacaoEm: new Date(),
        status: 'CONECTADO',
        mensagemErro: null,
      },
    });

    return {
      conexaoId,
      instituicaoNome: conexao.instituicaoNome,
      contasProcessadas: contasMapeadas,
      resumo: {
        novosMovimentosInseridos: totalInseridos,
        movimentosIgnoradosDedupe: totalDedupeIgnorados,
      },
    };
  }

  /**
   * Revoga consentimento e desconecta o banco
   */
  public async disconnect(params: { usuarioId: string; conexaoId: string }) {
    const { usuarioId, conexaoId } = params;

    const conexao = await prisma.conexaoBancaria.findFirst({
      where: { id: conexaoId, usuarioId },
    });

    if (!conexao) {
      throw new Error('Conexão não encontrada.');
    }

    if (conexao.consentimentoId) {
      try {
        const provider = BankConnectorFactory.getProvider(conexao.instituicaoCodigo);
        await provider.revokeConsent(conexao.consentimentoId);
      } catch {
        // Ignora erro no revoke externo e atualiza status local
      }
    }

    return prisma.conexaoBancaria.update({
      where: { id: conexaoId },
      data: {
        status: 'REVOGADO',
        consentimentoId: null,
        mensagemErro: 'Consentimento revogado pelo usuário.',
      },
    });
  }

  /**
   * Parser universal para importação direta de arquivo (OFX, CSV, JSON)
   */
  public parseStatement(content: string, filename?: string): ParseResult {
    return this.parser.parse(content, filename);
  }

  /**
   * Importa transações a partir de um extrato parseado ou conteúdo textual para uma conta
   */
  public async importStatement(params: {
    usuarioId: string;
    contaId: string;
    content: string;
    filename?: string;
  }): Promise<NormalizationPipelineResult & { formato: string }> {
    const { usuarioId, contaId, content, filename } = params;

    const parseResult = this.parser.parse(content, filename);
    if (parseResult.transacoes.length === 0 && parseResult.erros.length > 0) {
      throw new Error(`Erro ao analisar extrato: ${parseResult.erros.join(', ')}`);
    }

    const pipelineResult = await this.pipeline.processAndIngest(usuarioId, {
      contaId,
      transacoes: parseResult.transacoes,
      origemDocumento: filename || `IMPORT_${parseResult.formato}`,
    });

    return {
      ...pipelineResult,
      formato: parseResult.formato,
    };
  }
}
