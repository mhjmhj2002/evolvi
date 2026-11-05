import { LancamentoConsolidadoIa } from '../../importacao/worker/ia-extrator.schema.js';
import { InterBankConnectorProvider } from '../providers/inter-bank-connector.provider.js';

const MESES_MAP: Record<string, string> = {
  janeiro: '01',
  fevereiro: '02',
  março: '03',
  marco: '03',
  abril: '04',
  maio: '05',
  junho: '06',
  julho: '07',
  agosto: '08',
  setembro: '09',
  outubro: '10',
  novembro: '11',
  dezembro: '12',
};

/**
 * Parser determinístico especializado em Extratos de Conta Corrente em PDF do Banco Inter (COMPE 077).
 *
 * Características do Extrato Inter:
 * - Cabeçalho:
 *     <Nome do Titular>
 *     CPF/CNPJ: 000.000.000-00, Instituição: Banco Inter, Agência: 0001-9, Conta: 2422097-3
 *     Período: DD/MM/AAAA a DD/MM/AAAA
 * - Seções diárias:
 *     DD de <Mês> de AAAA Saldo do dia: R$ XXX,XX
 * - Transações diárias:
 *     <Descrição>                          <Valor: -R$ X,XX ou R$ X,XX>          <Saldo por transação>
 * - Rodapé em cada página:
 *     Fale com a gente / SAC: 0800 940 9999 ...
 */
export class InterStatementPdfParser {
  /**
   * Verifica se o texto extraído do PDF possui evidências claras de ser extrato de conta corrente do Banco Inter.
   */
  public static isInterStatement(texto: string): boolean {
    if (!texto) return false;
    const lower = texto.toLowerCase();

    // Padrão 1: Cabeçalho com Instituição: Banco Inter + Agência + Conta
    const hasInterHeader =
      /institui[çc][ãa]o:\s*banco\s*inter/i.test(texto) &&
      /ag[êe]ncia:\s*[0-9\-]+/i.test(texto) &&
      /conta:\s*[0-9\-]+/i.test(texto);

    // Padrão 2: Período + Saldo do dia + menção a Banco Inter
    const hasInterBody =
      lower.includes('banco inter') &&
      /per[íi]odo:\s*\d{2}\/\d{2}\/\d{4}\s*a\s*\d{2}\/\d{2}\/\d{4}/i.test(texto) &&
      /saldo\s+do\s+dia:\s*-?r\$/i.test(texto);

    return hasInterHeader || hasInterBody;
  }

  /**
   * Extrai os metadados de agência, conta corrente e titular do cabeçalho do Banco Inter.
   */
  public static extrairMetadadosConta(texto: string): {
    agencia: string | null;
    numeroConta: string | null;
    titular: string | null;
    periodoInicio: string | null;
    periodoFim: string | null;
  } {
    const agContaMatch = texto.match(/Ag[êe]ncia:\s*([0-9\-]+)[^\n]*,?\s*Conta:\s*([0-9\-]+)/i);
    const agencia = agContaMatch ? agContaMatch[1].trim() : null;
    const rawConta = agContaMatch ? agContaMatch[2].trim() : null;
    const numeroConta = rawConta ? rawConta.replace(/\D/g, '') : null;

    const titularMatch = texto.match(/\n\s*([A-Z\s]{4,60})\r?\nCPF\/CNPJ:\s*([0-9.\-\/]+),\s*Institui[çc][ãa]o:\s*Banco Inter/);
    const titular = titularMatch ? titularMatch[1].trim() : null;

    const periodoMatch = texto.match(/Per[íi]odo:\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/i);
    const periodoInicio = periodoMatch ? periodoMatch[1] : null;
    const periodoFim = periodoMatch ? periodoMatch[2] : null;

    return { agencia, numeroConta, titular, periodoInicio, periodoFim };
  }

  /**
   * Realiza a extração determinística e estruturada de todas as transações do extrato Banco Inter.
   */
  public static parse(
    texto: string,
    contexto?: {
      dataReferencia?: string;
      categorias?: { id: string; nome: string }[];
      nomeTitular?: string | null;
    }
  ): LancamentoConsolidadoIa[] {
    const { agencia, numeroConta, titular } = this.extrairMetadadosConta(texto);
    const nomeTitularEfetivo = contexto?.nomeTitular || titular;

    const lines = texto.split(/\r?\n/);
    const transacoes: LancamentoConsolidadoIa[] = [];

    let currentDate: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detecta linha de data diária: Ex: " 1 de Abril de 2026 Saldo do dia: R$ 618,42"
      const dateMatch = line.match(/^\s*(\d{1,2})\s+de\s+([A-Za-zçÇ]+)\s+de\s+(\d{4})/i);
      if (dateMatch) {
        const dia = dateMatch[1].padStart(2, '0');
        const mesNome = dateMatch[2].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const mesNum = MESES_MAP[mesNome];
        const ano = dateMatch[3];
        if (mesNum) {
          currentDate = `${ano}-${mesNum}-${dia}`;
        }
      }

      // Ignora linhas de cabeçalho geral ou rodapé de suporte
      if (
        !currentDate ||
        line.includes('Saldo do dia') ||
        line.includes('Saldo total') ||
        line.includes('Saldo disponível') ||
        line.includes('Saldo bloqueado') ||
        line.includes('Fale com a gente') ||
        line.includes('SAC:') ||
        line.includes('Ouvidoria:') ||
        line.includes('Deficiência de fala')
      ) {
        continue;
      }

      // Linha de transação tabular com valor e saldo:
      // Ex: " Imposto IOF Adicional                                  -R$ 0,04           R$ 618,46"
      const valMatch = line.match(/(-?R\$\s*[\d\.,]+)\s+(-?R\$\s*[\d\.,]+)\s*$/);
      if (!valMatch) continue;

      const valorStr = valMatch[1];
      const descPart = line.substring(0, line.lastIndexOf(valorStr)).trim().replace(/^\f\s*/, '');
      if (!descPart) continue;

      const rawValor = valorStr
        .replace('R$', '')
        .replace(/\s+/g, '')
        .replace(/\./g, '')
        .replace(',', '.')
        .trim();

      const numValor = parseFloat(rawValor);
      if (isNaN(numValor) || numValor === 0) continue;

      const isNegativo = numValor < 0;
      const valor = Math.abs(numValor);

      // Limpa aspas e espaçamentos duplos na descrição
      let descricaoFinal = descPart.replace(/"/g, '').replace(/\s+/g, ' ').trim();
      if (!descricaoFinal) {
        descricaoFinal = 'Lançamento Banco Inter';
      }

      // Classificação automática usando o catálogo de regras do Banco Inter
      const classif = InterBankConnectorProvider.classificarTransacaoInter(descricaoFinal);
      const descLower = descricaoFinal.toLowerCase();

      // Checagem de mesma titularidade para transferências próprias (PIX/TED entre contas do mesmo titular)
      const isMesmoTitular =
        Boolean(nomeTitularEfetivo) &&
        (descLower.includes(nomeTitularEfetivo!.toLowerCase()) ||
          descLower.includes('manuel alejandro hino') ||
          descLower.includes('manuel alejandro hinojosa'));

      let natureza: 'DESPESA' | 'RECEITA' | 'TRANSFERENCIA_PROPRIA' | 'APORTE_PATRIMONIAL' =
        isNegativo ? 'DESPESA' : 'RECEITA';

      let isPagamentoFatura = false;

      if (
        classif.isPagamentoFatura ||
        descLower.includes('debito automatico fatura cartao inter') ||
        descLower.includes('fatura cartao inter') ||
        descLower.includes('pagamento efetuado: banco c6 s.a.') ||
        descLower.includes('pagamento efetuado: nu pagamentos')
      ) {
        natureza = 'TRANSFERENCIA_PROPRIA';
        isPagamentoFatura = true;
      } else if (
        isMesmoTitular &&
        (descLower.includes('pix enviado') ||
          descLower.includes('pix recebido') ||
          descLower.includes('ted recebida') ||
          descLower.includes('ted enviada') ||
          descLower.includes('transferencia recebida'))
      ) {
        natureza = 'TRANSFERENCIA_PROPRIA';
      } else if (
        !isNegativo ||
        descLower.includes('credito evento b3') ||
        descLower.includes('rendimento') ||
        descLower.includes('cashback') ||
        descLower.includes('devolucao')
      ) {
        natureza = isNegativo ? 'DESPESA' : 'RECEITA';
      } else if (classif.natureza) {
        natureza = classif.natureza;
      }

      // Categoria sugerida
      let categoriaSugerida = isPagamentoFatura ? null : classif.categoriaSugerida || null;
      if (natureza === 'TRANSFERENCIA_PROPRIA') {
        categoriaSugerida = null;
      } else if (descLower.includes('credito evento b3') || descLower.includes('rendimento')) {
        categoriaSugerida = 'Aplicações / Investimentos';
      }

      transacoes.push({
        dataMovimento: currentDate,
        descricao: descricaoFinal,
        valor,
        natureza,
        contaSugerida: 'Banco Inter',
        tipoConta: 'CONTA_CORRENTE',
        numeroConta: numeroConta || '24220973',
        digitosCartao: null,
        categoriaSugerida,
        parcelaAtual: null,
        totalParcelas: null,
        idOrigem: null,
        isPagamentoFatura,
        observacao: isPagamentoFatura
          ? 'Pagamento de fatura de cartão de crédito (anti-dupla contagem)'
          : `Extrato Banco Inter Conta Corrente (Ag ${agencia || '0001-9'})`,
        confianca: 0.99,
      });
    }

    return transacoes;
  }
}
