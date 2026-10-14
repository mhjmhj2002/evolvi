import { LancamentoConsolidadoIa } from '../../importacao/worker/ia-extrator.schema.js';

/**
 * Parser heurístico especializado em faturas de cartão de crédito em PDF do C6 Bank.
 *
 * Características da fatura C6:
 * - Vencimento e fechamento informados no cabeçalho/resumo;
 * - Múltiplos cartões discriminados (C6 Carbon Final XXXX, Cartões Virtuais, Cartões Adicionais);
 * - Linhas de transações com padrão tabular:
 *   DD mmm    DESCRICAO DA COMPRA [- Parcela X/Y]      VALOR
 * - Despesas normais discriminadas em valores positivos;
 * - Pagamentos de fatura (ex: "Pag Fatura Boleto") discriminados com regra anti-dupla contagem
 *   (natureza: 'TRANSFERENCIA_PROPRIA' e isPagamentoFatura: true);
 * - Subtotais por cartão e valor total de fatura.
 */
export class C6InvoicePdfParser {
  private static readonly MESES_MAP: Record<string, string> = {
    jan: '01',
    fev: '02',
    mar: '03',
    abr: '04',
    mai: '05',
    jun: '06',
    jul: '07',
    ago: '08',
    set: '09',
    out: '10',
    nov: '11',
    dez: '12',
  };

  /**
   * Verifica se o texto extraído do PDF possui evidências claras de ser fatura do C6 Bank.
   */
  public static isC6Invoice(texto: string): boolean {
    const lower = texto.toLowerCase();
    return (
      (lower.includes('c6 bank') || lower.includes('cartão c6') || lower.includes('c6 carbon')) &&
      (lower.includes('fatura') || lower.includes('transações do cartão') || lower.includes('vencimento'))
    );
  }

  /**
   * Realiza a extração tabular das transações da fatura C6 Bank.
   */
  public static parse(
    texto: string,
    contexto?: {
      dataReferencia?: string;
      categorias?: { id: string; nome: string }[];
    }
  ): LancamentoConsolidadoIa[] {
    const lines = texto.split(/\r?\n/);

    // 1. Identificar ano e mês de referência da fatura
    // Ex: "Vencimento: 20/01/2026" ou "vencimento em Janeiro" ou via contexto
    let anoFatura = contexto?.dataReferencia
      ? contexto.dataReferencia.substring(0, 4)
      : new Date().getFullYear().toString();
    let mesFatura = contexto?.dataReferencia
      ? contexto.dataReferencia.substring(5, 7)
      : (new Date().getMonth() + 1).toString().padStart(2, '0');

    const vencimentoMatch = texto.match(/vencimento:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    if (vencimentoMatch) {
      mesFatura = vencimentoMatch[2];
      anoFatura = vencimentoMatch[3];
    } else {
      const vencimentoExtensoMatch = texto.match(/vencimento\s+em\s+([a-zç]+)/i);
      if (vencimentoExtensoMatch) {
        const mesExtenso = vencimentoExtensoMatch[1].substring(0, 3).toLowerCase();
        if (this.MESES_MAP[mesExtenso]) {
          mesFatura = this.MESES_MAP[mesExtenso];
        }
      }
    }

    const mesFaturaNum = parseInt(mesFatura, 10);
    const anoFaturaNum = parseInt(anoFatura, 10);

    // 2. Regex de cabeçalho de seção de cartão C6
    // Ex: "C6 Carbon Final 2458 - MANUEL A H JARA"
    // Ex: "C6 Carbon Virtual Final 7936 - MANUEL A H JARA   Cartão Virtual"
    // Ex: "C6 Carbon Final 2469 - LISSETTE LABARCA"
    const cardHeaderRegex =
      /C6 Carbon (?:Virtual )?Final (\d{4})\s*-\s*([A-Z\s]+?)(?:\s+(?:Cartão Virtual|Subtotal)|\s*$)/i;

    let currentCardNome = 'Cartão C6 Carbon';

    // 3. Regex para linhas de transação:
    // "     28 jan    BOTOESTHETIC VV LTDA - Parcela 12/12                                75,00"
    // "     22 dez       Pag Fatura Boleto                                             4.248,15"
    const dateRegex =
      /^\s*(\d{2})\s+([a-z]{3})\s+(.+?)\s+((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})\s*$/i;

    const transacoes: LancamentoConsolidadoIa[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Atualiza o cartão de contexto conforme avançamos nas páginas
      const cardMatch = line.match(cardHeaderRegex);
      if (cardMatch) {
        const finalDigitos = cardMatch[1];
        const titular = cardMatch[2].trim();
        currentCardNome = `C6 Carbon Final ${finalDigitos} (${titular})`;
      }

      const match = line.match(dateRegex);
      if (match) {
        const dia = match[1].padStart(2, '0');
        const mesStr = match[2].toLowerCase();
        const descBruta = match[3].trim();
        const rawValor = match[4].replace(/\./g, '').replace(',', '.');
        const valor = parseFloat(rawValor);

        if (isNaN(valor) || valor <= 0) {
          continue;
        }

        const mes = this.MESES_MAP[mesStr] || mesFatura;
        const mesTxNum = parseInt(mes, 10);

        // Se o mês da compra for maior que o mês da fatura (ex: dez/nov e fatura é jan/fev),
        // a transação ocorreu no ano anterior.
        let ano = anoFatura;
        if (mesTxNum > mesFaturaNum) {
          ano = (anoFaturaNum - 1).toString();
        }

        const dataMovimento = `${ano}-${mes}-${dia}`;

        // Identificação de parcelas (ex: "Parcela 12/12" ou "6/10")
        let parcelaAtual: number | null = null;
        let totalParcelas: number | null = null;
        const matchParcela = descBruta.match(/(?:Parcela\s+)?(\d+)\s*\/\s*(\d+)/i);
        if (matchParcela) {
          parcelaAtual = parseInt(matchParcela[1], 10);
          totalParcelas = parseInt(matchParcela[2], 10);
        }

        // Anti-dupla contagem estrita em pagamentos de fatura
        const isPagamento =
          /pag(amento)?\s*(de)?\s*fat(ura)?|pgto\s*fat(ura)?|fatura\s*boleto/i.test(descBruta);

        const natureza = isPagamento ? 'TRANSFERENCIA_PROPRIA' : 'DESPESA';
        const categoriaSugerida = isPagamento
          ? null
          : this.classificarCategoriaPof(descBruta, contexto?.categorias);

        // Se for compra parcelada (ex: Parcela X/Y), a data impressa pelo banco representa a compra original.
        // O débito / exigibilidade financeira desta parcela pertence à competência da fatura em cobrança!
        // Portanto, a data de movimento financeiro é alocada no mês da fatura (no dia do vencimento/fechamento),
        // preservando a data original de compra na observação para auditoria exata.
        let dataMovimentoFinal = dataMovimento;
        let observacaoTransacao = `Fatura C6 Bank - ${currentCardNome}`;

        if (parcelaAtual !== null && totalParcelas !== null) {
          // Atribui o débito da parcela ao mês/ano da fatura (ex: 2026-01-20 ou dia do fechamento)
          const diaFechamentoFatura = vencimentoMatch ? vencimentoMatch[1] : '10';
          dataMovimentoFinal = `${anoFatura}-${mesFatura}-${diaFechamentoFatura}`;
          observacaoTransacao += ` (Compra original parcelada em ${dia}/${mes}/${ano})`;
        }

        transacoes.push({
          dataMovimento: dataMovimentoFinal,
          descricao: descBruta,
          valor,
          natureza,
          contaSugerida: currentCardNome,
          tipoConta: 'CARTAO_CREDITO',
          categoriaSugerida,
          parcelaAtual,
          totalParcelas,
          isPagamentoFatura: isPagamento,
          observacao: observacaoTransacao,
          confianca: 0.99,
        });
      }
    }

    return transacoes;
  }

  /**
   * Mapeamento heurístico de descrições para categorias da POF (Pesquisa de Orçamentos Familiares)
   */
  public static classificarCategoriaPof(
    descricao: string,
    categoriasDisponiveis?: { id: string; nome: string }[]
  ): string | null {
    const d = descricao.toLowerCase();

    // 1. Saúde / Farmácia
    if (
      d.includes('drog') ||
      d.includes('farm') ||
      d.includes('rdsaude') ||
      d.includes('remedio') ||
      d.includes('crescerfarma') ||
      d.includes('oticas') ||
      d.includes('otica')
    ) {
      return this.resolverCategoria('Saúde', 'Farmácia', categoriasDisponiveis);
    }

    // 2. Alimentação / Supermercado / Padaria / Restaurante
    if (
      d.includes('extrabom') ||
      d.includes('carone') ||
      d.includes('carrefour') ||
      d.includes('mercado') ||
      d.includes('hortifruti')
    ) {
      return this.resolverCategoria('Alimentação', 'Supermercado', categoriasDisponiveis);
    }

    if (d.includes('padaria') || d.includes('panificadora')) {
      return this.resolverCategoria('Alimentação', 'Padaria', categoriasDisponiveis);
    }

    if (
      d.includes('ifood') ||
      d.includes('ifd*') ||
      d.includes('delivery') ||
      d.includes('tedsdelivery')
    ) {
      return this.resolverCategoria('Alimentação', 'Delivery', categoriasDisponiveis);
    }

    if (
      d.includes('restaurante') ||
      d.includes('bar') ||
      d.includes('sport bar') ||
      d.includes('pizza') ||
      d.includes('poke beach') ||
      d.includes('gastro') ||
      d.includes('sorvet') ||
      d.includes('chiquinho')
    ) {
      return this.resolverCategoria('Alimentação', 'Refeição fora', categoriasDisponiveis);
    }

    // 3. Transporte / Combustível
    if (
      d.includes('posto') ||
      d.includes('combustivel') ||
      d.includes('gasolina') ||
      d.includes('ipiranga') ||
      d.includes('shell') ||
      d.includes('uber') ||
      d.includes('99app')
    ) {
      return this.resolverCategoria('Transporte', 'Combustível', categoriasDisponiveis);
    }

    // 4. Pets / Veterinário
    if (d.includes('pet') || d.includes('veterinaria') || d.includes('veterinario')) {
      return this.resolverCategoria('Pets', 'Veterinário', categoriasDisponiveis);
    }

    // 5. Serviços Digitais / Streaming / Assinaturas
    if (
      d.includes('spotify') ||
      d.includes('netflix') ||
      d.includes('amazon') ||
      d.includes('prime') ||
      d.includes('apple') ||
      d.includes('google')
    ) {
      return this.resolverCategoria('Serviços digitais', 'Assinaturas e ferramentas', categoriasDisponiveis);
    }

    // 6. Educação / Treinamentos
    if (d.includes('curso') || d.includes('escola') || d.includes('faculdade') || d.includes('livraria') || d.includes('leitura')) {
      return this.resolverCategoria('Educação', 'Cursos e treinamentos', categoriasDisponiveis);
    }

    // 7. Vestuário / Acessórios / Bijuterias
    if (d.includes('riachuelo') || d.includes('renner') || d.includes('zara') || d.includes('bijuteria') || d.includes('fashion')) {
      return this.resolverCategoria('Vestuário e acessórios', 'Roupas', categoriasDisponiveis);
    }

    // 8. Tarifas / Anuidade de Cartão
    if (d.includes('anuidade') || d.includes('tarifa') || d.includes('iof') || d.includes('juros')) {
      return this.resolverCategoria('Tarifas financeiras', 'Anuidade de cartão', categoriasDisponiveis);
    }

    // 9. Moradia / Utensílios / Embalagens
    if (d.includes('embalagens') || d.includes('papelaria') || d.includes('botoesthetic') || d.includes('lojas sipolatti') || d.includes('casas bahia') || d.includes('magalu')) {
      return this.resolverCategoria('Moradia', 'Utensílios e eletroportáteis', categoriasDisponiveis);
    }

    return this.resolverCategoria('Outros', 'Outros', categoriasDisponiveis);
  }

  private static resolverCategoria(
    preferencia: string,
    subcategoria: string,
    categoriasDisponiveis?: { id: string; nome: string }[]
  ): string {
    if (!categoriasDisponiveis || categoriasDisponiveis.length === 0) {
      return preferencia;
    }

    // Procura exata por subcategoria ou categoria principal
    const matchSub = categoriasDisponiveis.find(
      (c) => c.nome.toLowerCase() === subcategoria.toLowerCase()
    );
    if (matchSub) return matchSub.nome;

    const matchPref = categoriasDisponiveis.find((c) =>
      c.nome.toLowerCase().includes(preferencia.toLowerCase())
    );
    if (matchPref) return matchPref.nome;

    return categoriasDisponiveis[0].nome;
  }
}
