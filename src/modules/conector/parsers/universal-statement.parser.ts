import { BankAccountRaw, BankTransactionRaw } from '../types/bank-connector.interface.js';
import { ItauBankConnectorProvider } from '../providers/itau-bank-connector.provider.js';

export interface ParseResult {
  formato: 'OFX' | 'CSV' | 'JSON';
  contaSugerida?: Partial<BankAccountRaw>;
  transacoes: BankTransactionRaw[];
  erros: string[];
}

/**
 * Parser universal para arquivos de extrato financeiro (OFX, CSV, JSON).
 * Suporta extratos exportados por bancos brasileiros e cooperativas.
 */
export class UniversalStatementParser {
  /**
   * Identifica o formato e processa o conteúdo de texto
   */
  public parse(content: string, filename?: string): ParseResult {
    const trimmed = content.trim();

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return this.parseJSON(trimmed);
    }

    if (
      trimmed.includes('<OFX>') ||
      trimmed.includes('<BANKTRANLIST>') ||
      trimmed.includes('OFXHEADER') ||
      (filename && filename.toLowerCase().endsWith('.ofx'))
    ) {
      return this.parseOFX(trimmed);
    }

    // Padrão CSV
    return this.parseCSV(trimmed);
  }

  /**
   * Parser OFX robusto para extratos bancários e cartões de crédito
   */
  public parseOFX(content: string): ParseResult {
    const transacoes: BankTransactionRaw[] = [];
    const erros: string[] = [];
    let contaSugerida: Partial<BankAccountRaw> | undefined;

    try {
      // Extrair informações de conta se disponíveis
      const acctIdMatch = content.match(/<ACCTID>([^<\r\n]+)/i);
      const bankIdMatch = content.match(/<BANKID>([^<\r\n]+)/i);
      const isCreditCard = content.includes('<CCSTMTRS>') || content.includes('<CCACCTFROM>');
      const idExternoConta = acctIdMatch ? acctIdMatch[1].trim() : undefined;

      contaSugerida = {
        idExterno: idExternoConta,
        numeroConta: !isCreditCard ? idExternoConta : undefined,
        digitosCartao: isCreditCard && idExternoConta ? idExternoConta.slice(-4) : undefined,
        nome: `${isCreditCard ? 'Cartão' : 'Conta'} ${bankIdMatch ? `Banco ${bankIdMatch[1].trim()}` : 'OFX'}`,
        tipo: isCreditCard ? 'CARTAO_CREDITO' : 'CONTA_CORRENTE',
      };

      // Captura blocos <STMTTRN>...</STMTTRN>
      const trnRegex = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|$)/gi;
      let match: RegExpExecArray | null;

      while ((match = trnRegex.exec(content)) !== null) {
        const bloco = match[1];
        if (!bloco.trim()) continue;

        // Tags do bloco
        const trnType = this.extractTagValue(bloco, 'TRNTYPE');
        const dtPosted = this.extractTagValue(bloco, 'DTPOSTED');
        const trnAmt = this.extractTagValue(bloco, 'TRNAMT');
        const fitId = this.extractTagValue(bloco, 'FITID');
        const memo = this.extractTagValue(bloco, 'MEMO') || this.extractTagValue(bloco, 'NAME');

        if (!dtPosted || !trnAmt) {
          continue;
        }

        // Formatação de data (geralmente YYYYMMDD ou YYYYMMDDHHMMSS)
        const ano = dtPosted.substring(0, 4);
        const mes = dtPosted.substring(4, 6);
        const dia = dtPosted.substring(6, 8);
        const dataFormatada = `${ano}-${mes}-${dia}`;

        const valorNumerico = parseFloat(trnAmt.replace(',', '.'));
        if (isNaN(valorNumerico)) continue;

        const isNegativo = valorNumerico < 0;
        const valorAbsoluto = Math.abs(valorNumerico);
        const descricaoNormalizada = (memo || trnType || 'Lançamento OFX').trim();

        // Identificação Itaú / Bancos Brasileiros: Categorização POF e anti-dupla contagem
        const classif = (bankIdMatch && bankIdMatch[1].trim() === '341') || /itau/i.test(content)
          ? ItauBankConnectorProvider.classificarTransacaoItau(descricaoNormalizada)
          : {
              categoriaSugerida: undefined,
              natureza: (isNegativo ? 'DESPESA' : 'RECEITA') as BankTransactionRaw['natureza'],
              isPagamentoFatura: false,
            };

        const isPagamento =
          Boolean(classif.isPagamentoFatura) ||
          /pag(amento|to)?\s*(efetuado|de\s*fat(ura)?|da\s*fat(ura)?|fatura|recebido)|fatura\s*cart[aã]o|debito\s*automatico\s*fatura|pag\s*fatura/i.test(
            descricaoNormalizada
          ) ||
          (/pag\s*boleto|pagamento\s*boleto|pagto\s*boleto/i.test(descricaoNormalizada) &&
            /nu\s*pagamentos|nubank|c6\s*bank|banco\s*c6|bradescard|itaucard|cart[aã]o|credicard|santander\s*cart[oõ]es/i.test(descricaoNormalizada));


        let natureza: BankTransactionRaw['natureza'] = isPagamento
          ? 'TRANSFERENCIA_PROPRIA'
          : classif.natureza || (isNegativo ? 'DESPESA' : 'RECEITA');

        transacoes.push({
          idExterno: fitId || undefined,
          data: dataFormatada,
          descricao: descricaoNormalizada,
          valor: valorAbsoluto,
          natureza,
          isPagamentoFatura: isPagamento,
          categoriaSugerida: classif.categoriaSugerida,
          memo: memo || undefined,
        });
      }
    } catch (err: unknown) {
      erros.push(`Falha no parser OFX: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      formato: 'OFX',
      contaSugerida,
      transacoes,
      erros,
    };
  }

  /**
   * Parser CSV com detecção automática de delimitador (; ou ,) e colunas (Data, Descrição, Valor)
   */
  public parseCSV(content: string): ParseResult {
    const transacoes: BankTransactionRaw[] = [];
    const erros: string[] = [];
    let contaSugerida: Partial<BankAccountRaw> | undefined;

    try {
      const linhas = content
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      if (linhas.length === 0) {
        return { formato: 'CSV', contaSugerida, transacoes: [], erros: ['Arquivo CSV vazio'] };
      }

      // Detecção da primeira linha com delimitadores para avaliar estrutura tabular
      const primeiroLinha = linhas[0];
      const countPontoEVirgulaPrimeira = (primeiroLinha.match(/;/g) || []).length;
      const countVirgulaPrimeira = (primeiroLinha.match(/,/g) || []).length;
      const countTabPrimeira = (primeiroLinha.match(/\t/g) || []).length;

      // Varredura inteligente das primeiras 15 linhas para encontrar a linha do cabeçalho
      let linhaCabecalhoIdx = -1;
      let delimitador = ';';
      let idxData = -1;
      let idxDesc = -1;
      let idxValor = -1;
      let colunasCabecalho: string[] = [];

      const maxScan = Math.min(linhas.length, 15);
      for (let i = 0; i < maxScan; i++) {
        const linhaCandidata = linhas[i];
        const countPontoEVirgula = (linhaCandidata.match(/;/g) || []).length;
        const countVirgula = (linhaCandidata.match(/,/g) || []).length;
        const countTab = (linhaCandidata.match(/\t/g) || []).length;

        if (countPontoEVirgula === 0 && countVirgula === 0 && countTab === 0) {
          continue;
        }

        let candDelim = ';';
        if (countTab > countPontoEVirgula && countTab > countVirgula) {
          candDelim = '\t';
        } else if (countVirgula > countPontoEVirgula) {
          candDelim = ',';
        }

        const colunas = linhaCandidata
          .split(candDelim)
          .map((col) => col.replace(/["']/g, '').trim().toLowerCase());

        const cData = colunas.findIndex((c) => /^(data|date|dt|data\s+movimento|data\s+lan[cç]amento)$/i.test(c) || /\b(data|date|dt)\b/i.test(c));
        const cDesc = colunas.findIndex((c) => /^(descri[cç][aã]o|historico|hist[oó]rico|memo|detalhe|lan[cç]amento)$/i.test(c) || /\b(descri[cç][aã]o|historico|hist[oó]rico|memo)\b/i.test(c));
        const cValor = colunas.findIndex((c) => /^(valor|value|amount|quantia|valor\s+r\$)$/i.test(c) || /\b(valor|value|amount|quantia)\b/i.test(c));

        if (cData >= 0 && cValor >= 0 && cData !== cValor && colunas.length >= 2) {
          linhaCabecalhoIdx = i;
          delimitador = candDelim;
          idxData = cData;
          idxDesc = cDesc;
          idxValor = cValor;
          colunasCabecalho = colunas;
          break;
        }
      }

      // Se não encontrou cabeçalho e a primeira linha não tinha delimitador tabular estrutural, retorna erro de delimitador
      if (countPontoEVirgulaPrimeira === 0 && countVirgulaPrimeira === 0 && countTabPrimeira === 0 && linhaCabecalhoIdx < 0) {
        return {
          formato: 'CSV',
          transacoes: [],
          erros: ['Arquivo CSV não possui delimitador tabular reconhecível (; ou ,).'],
        };
      }

      // Rigor estrito: CSV bancário DEVE possuir cabeçalho reconhecível com data e valor em colunas distintas
      if (linhaCabecalhoIdx < 0 || idxData < 0 || idxValor < 0 || idxData === idxValor) {
        return {
          formato: 'CSV',
          transacoes: [],
          erros: ['Arquivo CSV não possui cabeçalho padrão reconhecível com colunas de data e valor.'],
        };
      }

      const startIdx = linhaCabecalhoIdx + 1;
      const colData = idxData;
      const colValor = idxValor;

      // Suporte a CSVs bancários com colunas distintas de Histórico e Descrição (ex: Banco Inter: Histórico="Pix enviado", Descrição="Manuel Alejandro...")
      const idxHist = colunasCabecalho.findIndex((c) => /^(historico|hist[oó]rico)$/i.test(c));
      const idxDescOnly = colunasCabecalho.findIndex((c) => /^(descri[cç][aã]o|memo|detalhe|lan[cç]amento)$/i.test(c));
      const colDesc = idxDescOnly >= 0 ? idxDescOnly : (idxDesc >= 0 ? idxDesc : (idxData === 0 ? 1 : 0));

      // Extração de metadados de conta no pré-cabeçalho (linhas anteriores à linhaCabecalhoIdx)
      let numContaEncontrada: string | undefined;
      let agenciaEncontrada: string | undefined;

      for (let i = 0; i < linhaCabecalhoIdx; i++) {
        const linhaMeta = linhas[i];
        const contaMatch = linhaMeta.match(/(?:conta|conta\s*corrente)\s*[:;]?\s*([0-9.\-]+)/i);
        const agenciaMatch = linhaMeta.match(/(?:ag[eê]ncia|ag)\s*[:;]?\s*([0-9.\-]+)/i);

        if (contaMatch && !numContaEncontrada) {
          numContaEncontrada = contaMatch[1].trim();
        }
        if (agenciaMatch && !agenciaEncontrada) {
          agenciaEncontrada = agenciaMatch[1].trim();
        }
      }

      if (numContaEncontrada) {
        contaSugerida = {
          numeroConta: numContaEncontrada,
          agencia: agenciaEncontrada,
          idExterno: numContaEncontrada,
          tipo: 'CONTA_CORRENTE',
        };
      }

      for (let i = startIdx; i < linhas.length; i++) {
        const linha = linhas[i];
        const partes = linha.split(delimitador).map((p) => p.replace(/["']/g, '').trim());

        if (partes.length <= Math.max(colData, colDesc, colValor)) {
          continue;
        }

        const rawData = partes[colData];
        const rawDesc = partes[colDesc];
        const rawValor = partes[colValor];

        if (!rawData || !rawValor) continue;

        // Normalização de data (DD/MM/YYYY ou YYYY-MM-DD)
        const dataFormatada = this.normalizarData(rawData);
        if (!dataFormatada) {
          continue; // Linha inválida ou cabeçalho repetido
        }

        // Normalização de valor (ex: "R$ -1.250,50" -> -1250.50)
        const valorNumerico = this.normalizarValor(rawValor);
        if (isNaN(valorNumerico)) continue;

        const isNegativo = valorNumerico < 0;
        const valorAbsoluto = Math.abs(valorNumerico);

        let descricaoNormalizada = (rawDesc || 'Lançamento CSV').trim();
        if (idxHist >= 0 && idxDescOnly >= 0 && idxHist !== idxDescOnly) {
          const rawHistVal = (partes[idxHist] || '').trim();
          const rawDescVal = (partes[idxDescOnly] || '').trim();
          if (rawHistVal && rawDescVal && rawHistVal.toLowerCase() !== rawDescVal.toLowerCase()) {
            descricaoNormalizada = `${rawHistVal} - ${rawDescVal}`;
          } else {
            descricaoNormalizada = rawDescVal || rawHistVal || descricaoNormalizada;
          }
        }

        const classif = ItauBankConnectorProvider.classificarTransacaoItau(descricaoNormalizada);

        const isPagamento =
          Boolean(classif.isPagamentoFatura) ||
          /pag(amento|to)?\s*(efetuado|de\s*fat(ura)?|da\s*fat(ura)?|fatura|recebido)|fatura\s*cart[aã]o|debito\s*automatico\s*fatura|pag\s*fatura/i.test(
            descricaoNormalizada
          ) ||
          (/pag\s*boleto|pagamento\s*boleto|pagto\s*boleto/i.test(descricaoNormalizada) &&
            /nu\s*pagamentos|nubank|c6\s*bank|banco\s*c6|bradescard|itaucard|cart[aã]o|credicard|santander\s*cart[oõ]es/i.test(descricaoNormalizada));

        let natureza: BankTransactionRaw['natureza'] = isPagamento
          ? 'TRANSFERENCIA_PROPRIA'
          : (isNegativo ? 'DESPESA' : 'RECEITA');

        transacoes.push({
          data: dataFormatada,
          descricao: descricaoNormalizada,
          valor: valorAbsoluto,
          natureza,
          isPagamentoFatura: isPagamento,
          categoriaSugerida: classif.categoriaSugerida,
        });
      }
    } catch (err: unknown) {
      erros.push(`Falha no parser CSV: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      formato: 'CSV',
      contaSugerida,
      transacoes,
      erros,
    };
  }

  /**
   * Parser JSON para payloads estruturados
   */
  public parseJSON(content: string): ParseResult {
    const transacoes: BankTransactionRaw[] = [];
    const erros: string[] = [];

    try {
      const parsed = JSON.parse(content);
      const lista = Array.isArray(parsed) ? parsed : parsed.transacoes || parsed.lancamentos || [];

      for (const item of lista) {
        if (!item.data || item.valor === undefined) continue;

        const dataFormatada = this.normalizarData(String(item.data));
        const valorNum = typeof item.valor === 'number' ? item.valor : parseFloat(String(item.valor).replace(',', '.'));

        if (!dataFormatada || isNaN(valorNum)) continue;

        const valorAbs = Math.abs(valorNum);
        const isNegativo = valorNum < 0 || item.natureza === 'DESPESA';
        const descricao = String(item.descricao || item.memo || 'Lançamento JSON').trim();

        const isPagamentoFatura =
          Boolean(item.isPagamentoFatura) ||
          /pag(amento|to)?\s*(efetuado|de\s*fat(ura)?|da\s*fat(ura)?|fatura|recebido)|fatura\s*cart[aã]o|debito\s*automatico\s*fatura|pag\s*fatura/i.test(
            descricao
          ) ||
          (/pag\s*boleto|pagamento\s*boleto|pagto\s*boleto/i.test(descricao) &&
            /nu\s*pagamentos|nubank|c6\s*bank|banco\s*c6|bradescard|itaucard|cart[aã]o|credicard|santander\s*cart[oõ]es/i.test(descricao));


        let natureza: BankTransactionRaw['natureza'] = (item.natureza as BankTransactionRaw['natureza']) || (isNegativo ? 'DESPESA' : 'RECEITA');
        if (isPagamentoFatura) {
          natureza = 'TRANSFERENCIA_PROPRIA';
        }

        transacoes.push({
          idExterno: item.idExterno || item.id || undefined,
          data: dataFormatada,
          descricao,
          valor: valorAbs,
          natureza,
          isPagamentoFatura,
          categoriaSugerida: item.categoriaSugerida || undefined,
          memo: item.memo || undefined,
        });
      }
    } catch (err: unknown) {
      erros.push(`Falha no parser JSON: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      formato: 'JSON',
      transacoes,
      erros,
    };
  }

  private extractTagValue(xml: string, tag: string): string | null {
    const regex = new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i');
    const m = xml.match(regex);
    return m ? m[1].trim() : null;
  }

  private normalizarData(raw: string): string | null {
    const limpo = raw.trim();

    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(limpo)) {
      return limpo;
    }

    // DD/MM/YYYY
    const brMatch = limpo.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (brMatch) {
      const dia = brMatch[1].padStart(2, '0');
      const mes = brMatch[2].padStart(2, '0');
      const ano = brMatch[3];
      return `${ano}-${mes}-${dia}`;
    }

    // YYYYMMDD
    if (/^\d{8}$/.test(limpo)) {
      return `${limpo.substring(0, 4)}-${limpo.substring(4, 6)}-${limpo.substring(6, 8)}`;
    }

    return null;
  }

  private normalizarValor(raw: string): number {
    // Remove R$, espaços, pontos de milhar e converte vírgula decimal
    let limpo = raw.replace(/[R$\s]/g, '');

    // Se possui vírgula e ponto (ex: 1.250,50 ou -1,250.50)
    if (limpo.includes(',') && limpo.includes('.')) {
      if (limpo.lastIndexOf(',') > limpo.lastIndexOf('.')) {
        // Formato BR: 1.250,50
        limpo = limpo.replace(/\./g, '').replace(',', '.');
      } else {
        // Formato US: 1,250.50
        limpo = limpo.replace(/,/g, '');
      }
    } else if (limpo.includes(',')) {
      limpo = limpo.replace(',', '.');
    }

    return parseFloat(limpo);
  }
}
