import { LancamentoConsolidadoIa } from '../../importacao/worker/ia-extrator.schema.js';
import { SantanderBankConnectorProvider } from '../providers/santander-bank-connector.provider.js';

/**
 * Parser determinístico especializado em Extratos de Conta Corrente em PDF do Banco Santander Brasil.
 *
 * Características do Extrato Santander:
 * - Cabeçalho:
 *     EXTRATO DE CONTA
 *     Agência: XXXX | Conta: XX.XXXXXX.X
 *     Período: DD/MM/AAAA a DD/MM/AAAA
 *     Titular: <Nome>
 * - Resumo: Saldo inicial, Entradas, Saídas, Saldo final.
 * - Seção DETALHE DOS MOVIMENTOS:
 *     Linhas de data de cabeçalho: "Segunda, 19 de outubro de 2026"
 *     Linhas de transação tabular:
 *       Data (DD/MM/AAAA)        Descrição / Subdescrição            Valor (R$ ou -R$)       Saldo
 *     Em muitos casos a descrição principal fica na linha imediatamente anterior ou na mesma linha,
 *     e o complemento/favorecido fica na linha imediatamente posterior.
 */
export class SantanderStatementPdfParser {
  /**
   * Verifica se o texto extraído do PDF possui evidências claras de ser extrato de conta corrente Santander.
   */
  public static isSantanderStatement(texto: string): boolean {
    if (!texto) return false;
    const lower = texto.toLowerCase();

    // Padrão 1: Cabeçalho Santander oficial com agência, conta e detalhe dos movimentos
    const hasHeaderExtrato =
      lower.includes('extrato de conta') &&
      /ag[êe]ncia:\s*\d+\s*\|\s*conta:\s*[0-9.\-]+/i.test(texto) &&
      lower.includes('detalhe dos movimentos');

    // Padrão 2: Menção a Santander + Agência + Conta
    const hasSantanderHeader =
      (lower.includes('santander') || lower.includes('banco santander')) &&
      /ag[êe]ncia:\s*\d+/i.test(texto) &&
      /conta:\s*[0-9.\-]+/i.test(texto);

    return hasHeaderExtrato || hasSantanderHeader;
  }

  /**
   * Extrai o número da agência e conta corrente do cabeçalho do Santander
   */
  public static extrairMetadadosConta(texto: string): {
    agencia: string | null;
    numeroConta: string | null;
    titular: string | null;
  } {
    const headerMatch = texto.match(/Ag[êe]ncia:\s*(\d+)\s*\|\s*Conta:\s*([0-9.\-]+)/i);
    const agencia = headerMatch ? headerMatch[1].trim() : null;
    const rawConta = headerMatch ? headerMatch[2].trim() : null;
    const numeroConta = rawConta ? rawConta.replace(/\D/g, '') : null;

    const titularMatch = texto.match(/Titular:\s*([^\r\n]+)/i);
    const titular = titularMatch ? titularMatch[1].trim() : null;

    return { agencia, numeroConta, titular };
  }

  /**
   * Realiza a extração determinística e estruturada de todas as transações do extrato Santander.
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

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Padrão de linha com transação: DD/MM/AAAA [descrição opcional] Valor (R$ ou -R$) [Saldo]
      const m = line.match(
        /^\s*(\d{2})\/(\d{2})\/(\d{4})\s*(.*?)\s*(-?R\$\s*[\d\.,]+)\s*(-?R\$\s*[\d\.,]+)?\s*$/
      );

      if (!m) continue;

      const dia = m[1];
      const mes = m[2];
      const ano = m[3];
      const dataMovimento = `${ano}-${mes}-${dia}`;

      const sameLineDesc = m[4] ? m[4].trim() : '';
      const rawValor = m[5]
        .replace('R$', '')
        .replace(/\s+/g, '')
        .replace(/\./g, '')
        .replace(',', '.')
        .trim();

      const numValor = parseFloat(rawValor);
      if (isNaN(numValor) || numValor === 0) continue;

      const isNegativo = numValor < 0;
      const valor = Math.abs(numValor);

      const descPartes: string[] = [];

      if (sameLineDesc) {
        descPartes.push(sameLineDesc);
      } else {
        // Busca título da transação nas linhas anteriores (ex: "Pix recebido", "Operacoes credito imobiliario")
        for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
          const p = lines[j].trim();
          if (!p) continue;
          if (
            p.includes('DETALHE DOS MOVIMENTOS') ||
            p.startsWith('Data') ||
            /^(Segunda|Terça|Quarta|Quinta|Sexta|Sábado|Domingo)/i.test(p)
          ) {
            break;
          }
          descPartes.unshift(p);
          break;
        }

        // Busca detalhe complementar na linha posterior (ex: "Luis Alberto Labarca", "Banco Santander (br)")
        for (let j = i + 1; j <= Math.min(lines.length - 1, i + 3); j++) {
          const n = lines[j].trim();
          if (!n) continue;
          if (
            n.match(/^\d{2}\/\d{2}\/\d{4}/) ||
            /^(Segunda|Terça|Quarta|Quinta|Sexta|Sábado|Domingo)/i.test(n) ||
            n.includes('DETALHE DOS MOVIMENTOS') ||
            /^\d+\/\d+$/.test(n)
          ) {
            break;
          }
          descPartes.push(n);
          break;
        }
      }

      let descricaoFinal = descPartes.join(' - ').replace(/\s+/g, ' ').trim();
      if (!descricaoFinal) {
        descricaoFinal = 'Lançamento Santander';
      }

      // Extrai idOrigem se houver código identificador na descrição (ex: Icb48683937)
      let idOrigem: string | null = null;
      const icbMatch = descricaoFinal.match(/\b(Icb\d+|[A-Z0-9]{8,20})\b/);
      if (icbMatch && !/^(SANTANDER|PAGAMENTO|RECEBIDO|ENVIADO)$/i.test(icbMatch[1])) {
        idOrigem = icbMatch[1];
      }

      // Classificação especializada via regras do Santander
      const classif = SantanderBankConnectorProvider.classificarTransacaoSantander(descricaoFinal);
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

      if (classif.isPagamentoFatura || descLower.includes('pagamento cartao credito bce') || descLower.includes('fatura')) {
        natureza = 'TRANSFERENCIA_PROPRIA';
        isPagamentoFatura = true;
      } else if (
        isMesmoTitular &&
        (descLower.includes('pix enviado') || descLower.includes('pix recebido') || descLower.includes('ted recebida') || descLower.includes('ted enviada'))
      ) {
        natureza = 'TRANSFERENCIA_PROPRIA';
      } else if (descLower.includes('remuneracao aplicacao') || descLower.includes('rendimento')) {
        natureza = 'RECEITA';
      } else if (isNegativo) {
        natureza = 'DESPESA';
      } else if (classif.natureza) {
        natureza = classif.natureza;
      }

      // Categoria sugerida
      let categoriaSugerida = isPagamentoFatura ? null : classif.categoriaSugerida || null;
      if (natureza === 'TRANSFERENCIA_PROPRIA') {
        categoriaSugerida = null;
      } else if (descLower.includes('remuneracao aplicacao') || descLower.includes('rendimento')) {
        categoriaSugerida = 'Aplicações / Investimentos';
      } else if (descLower.includes('credito imobiliario') || descLower.includes('prest cr im')) {
        categoriaSugerida = 'Habitação';
      }

      transacoes.push({
        dataMovimento,
        descricao: descricaoFinal,
        valor,
        natureza,
        contaSugerida: 'Santander',
        tipoConta: 'CONTA_CORRENTE',
        numeroConta: numeroConta || '010830489',
        digitosCartao: null,
        categoriaSugerida,
        parcelaAtual: null,
        totalParcelas: null,
        idOrigem,
        isPagamentoFatura,
        observacao: isPagamentoFatura
          ? 'Pagamento de fatura de cartão de crédito Santander (anti-dupla contagem)'
          : `Extrato Santander Conta Corrente (Ag ${agencia || '3345'})`,
        confianca: 0.99,
      });
    }

    return transacoes;
  }
}
