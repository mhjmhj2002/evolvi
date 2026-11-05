/**
 * Utilitários e Parser para Notas Fiscais Eletrônicas (NFC-e / NF-e).
 * Suporta validação do Módulo 11 da Chave de Acesso de 44 dígitos
 * e decodificação de payloads e URLs de QR Code da SEFAZ estadual.
 */

export interface DadosChaveAcessoNfe {
  chave: string;
  ufCodigo: string;
  ufSigla: string;
  anoMes: string; // AAMM
  ano: number;
  mes: number;
  cnpj: string;
  modelo: string; // 65 = NFC-e, 55 = NF-e
  serie: string;
  numero: string;
  tipoEmissao: string;
  codigoNumerico: string;
  digitoVerificador: string;
  valida: boolean;
}

export interface PayloadQrCodeNfe {
  chaveAcesso: string;
  versao?: string;
  ambiente?: 'PRODUCAO' | 'HOMOLOGACAO';
  diaEmissao?: number;
  valorTotal?: number;
  digestValue?: string;
  urlOriginal?: string;
}

// Mapeamento de Código IBGE da UF para Sigla
export const CODIGO_IBGE_PARA_UF: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL',
  '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

/**
 * Remove qualquer caractere não numérico da string (espaços, pontos, barras, traços).
 */
export function limparChaveAcesso(chaveRaw: string): string {
  if (!chaveRaw) return '';
  return chaveRaw.replace(/\D/g, '');
}

/**
 * Calcula o Dígito Verificador (DV) da Chave de Acesso da NF-e / NFC-e usando Módulo 11 (pesos de 2 a 9).
 * Retorna o DV calculado como string ("0".."9").
 */
export function calcularDigitoVerificadorModulo11(chave43: string): string {
  if (chave43.length !== 43) {
    throw new Error('A chave para cálculo do DV deve conter exatamente 43 dígitos numéricos.');
  }

  let soma = 0;
  let peso = 2;

  // Percorre da direita para a esquerda
  for (let i = chave43.length - 1; i >= 0; i--) {
    const digito = parseInt(chave43[i], 10);
    soma += digito * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }

  const resto = soma % 11;
  const dv = 11 - resto;

  if (dv === 0 || dv === 1 || dv >= 10) {
    return '0';
  }

  return dv.toString();
}

/**
 * Valida se uma string é uma chave de acesso de NF-e/NFC-e válida de 44 dígitos com DV correto.
 */
export function validarChaveAcessoNfe(chaveRaw: string): boolean {
  const chave = limparChaveAcesso(chaveRaw);
  if (chave.length !== 44) {
    return false;
  }

  const uf = chave.substring(0, 2);
  if (!CODIGO_IBGE_PARA_UF[uf]) {
    return false;
  }

  const chave43 = chave.substring(0, 43);
  const dvInformado = chave.substring(43, 44);
  const dvCalculado = calcularDigitoVerificadorModulo11(chave43);

  return dvInformado === dvCalculado;
}

/**
 * Decompõe uma chave de acesso de 44 dígitos em seus campos constitutivos oficiais do Manual da SEFAZ.
 */
export function decomporChaveAcesso(chaveRaw: string): DadosChaveAcessoNfe | null {
  const chave = limparChaveAcesso(chaveRaw);
  if (chave.length !== 44) {
    return null;
  }

  const ufCodigo = chave.substring(0, 2);
  const ufSigla = CODIGO_IBGE_PARA_UF[ufCodigo] || 'BR';
  const anoMes = chave.substring(2, 6);
  const aa = parseInt(anoMes.substring(0, 2), 10);
  const mm = parseInt(anoMes.substring(2, 4), 10);
  const ano = 2000 + aa;
  const mes = mm;
  const cnpj = chave.substring(6, 20);
  const modelo = chave.substring(20, 22);
  const serie = chave.substring(22, 25);
  const numero = chave.substring(25, 34);
  const tipoEmissao = chave.substring(34, 35);
  const codigoNumerico = chave.substring(35, 43);
  const digitoVerificador = chave.substring(43, 44);

  const valida = validarChaveAcessoNfe(chave);

  return {
    chave,
    ufCodigo,
    ufSigla,
    anoMes,
    ano,
    mes,
    cnpj,
    modelo,
    serie,
    numero,
    tipoEmissao,
    codigoNumerico,
    digitoVerificador,
    valida,
  };
}

/**
 * Extrai o payload de uma leitura de QR Code de NFC-e (ou chave direta de 44 dígitos ou URL).
 * Suporta formatos de QR Code versão 1 e 2 das SEFAZ estaduais (parâmetro p=, chNFe=, etc.).
 */
export function extrairPayloadQrCodeNfe(input: string): PayloadQrCodeNfe | null {
  if (!input || typeof input !== 'string') return null;

  const inputLimpo = input.trim();

  // 1. Caso direto: o input é puramente a chave de 44 dígitos (ou formatada com espaços)
  const chaveApenasDigitos = limparChaveAcesso(inputLimpo);
  if (chaveApenasDigitos.length === 44 && validarChaveAcessoNfe(chaveApenasDigitos)) {
    return {
      chaveAcesso: chaveApenasDigitos,
      urlOriginal: inputLimpo.startsWith('http') ? inputLimpo : undefined,
    };
  }

  // 2. Tentar como URL de QR Code da SEFAZ
  try {
    let urlString = inputLimpo;
    if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
      urlString = `https://${urlString}`;
    }

    const parsedUrl = new URL(urlString);
    const params = parsedUrl.searchParams;

    // Cenário A: Parâmetro 'p' (padrão nacional de NFC-e QR Code)
    // Exemplo: ?p=35260312345678000195650010001234561123456789|2|1|1|C7256F...
    // Ou com parâmetros separados por pipe: chNFe|versao|tpAmb|diaEmi|vNF|digVal|...
    const paramP = params.get('p') || params.get('P');
    if (paramP) {
      const partes = paramP.split('|');
      const possivelChave = limparChaveAcesso(partes[0]);
      if (possivelChave.length === 44 && validarChaveAcessoNfe(possivelChave)) {
        let valorTotal: number | undefined;
        let diaEmissao: number | undefined;
        let ambiente: 'PRODUCAO' | 'HOMOLOGACAO' | undefined;
        let versao: string | undefined;

        if (partes.length >= 2) {
          versao = partes[1];
        }
        if (partes.length >= 3) {
          ambiente = partes[2] === '2' ? 'HOMOLOGACAO' : 'PRODUCAO';
        }
        // Padrão NFC-e Manual Técnico DANFE e QR Code:
        // Versão 2.00 Online: p=chNFe|nVersao|tpAmb|cIdCSC|cHashQRCode (5 partes, sem dia e sem vNF)
        // Versão 2.00 Offline: p=chNFe|nVersao|tpAmb|dEmi|vNF|digVal|cIdCSC|cHashQRCode (8 partes, partes[3]=dia, partes[4]=vNF)
        // Versões anteriores ou personalizadas com vNF explícito (vNF deve ser float válido ou com dígitos decimais e não um token hash/identificador longo)
        const isOnlineVersao2 = partes.length === 5 && versao === '2';

        if (!isOnlineVersao2) {
          if (partes.length >= 4) {
            const diaNum = parseInt(partes[3], 10);
            if (!isNaN(diaNum) && diaNum >= 1 && diaNum <= 31) {
              diaEmissao = diaNum;
            }
          }
          if (partes.length >= 5) {
            // vNF deve ser um número decimal com até 2 casas decimais e menor que 100 milhões
            const vNFStr = partes[4].trim().replace(',', '.');
            if (/^\d+(\.\d{1,2})?$/.test(vNFStr)) {
              const vNum = parseFloat(vNFStr);
              if (!isNaN(vNum) && vNum > 0 && vNum < 100000000) {
                valorTotal = vNum;
              }
            }
          }
        }

        return {
          chaveAcesso: possivelChave,
          versao,
          ambiente,
          diaEmissao,
          valorTotal,
          digestValue: !isOnlineVersao2 ? partes[5] : undefined,
          urlOriginal: inputLimpo,
        };
      }
    }

    // Cenário B: Parâmetros explícitos na URL (ex: ?chNFe=... ou ?chave=...)
    const paramChNFe = params.get('chNFe') || params.get('chave') || params.get('ch');
    if (paramChNFe) {
      const possivelChave = limparChaveAcesso(paramChNFe);
      if (possivelChave.length === 44 && validarChaveAcessoNfe(possivelChave)) {
        const vNF = params.get('vNF') || params.get('valor');
        const valorNum = vNF ? parseFloat(vNF.replace(',', '.')) : undefined;

        return {
          chaveAcesso: possivelChave,
          valorTotal: valorNum && !isNaN(valorNum) && valorNum > 0 ? valorNum : undefined,
          urlOriginal: inputLimpo,
        };
      }
    }
  } catch {
    // Não é uma URL válida
  }

  // 3. Fallback de busca por regex de 44 dígitos no texto
  const matchRegexChave = inputLimpo.match(/\b(\d{44})\b/);
  if (matchRegexChave && validarChaveAcessoNfe(matchRegexChave[1])) {
    return {
      chaveAcesso: matchRegexChave[1],
      urlOriginal: inputLimpo,
    };
  }

  return null;
}

export interface DadosExtraidosSefazHtml {
  valorTotal?: number;
  razaoSocial?: string;
  dataEmissao?: string;
}

/**
 * Faz parse do HTML retornado pelo portal da SEFAZ para extrair o valor total, razão social e data.
 * Compatível com portais da SEFAZ (SVRS, SEFAZ-ES, SEFAZ-SP, SEFAZ-RS, etc.).
 */
export function parseHtmlSefazNfce(html: string): DadosExtraidosSefazHtml {
  const resultado: DadosExtraidosSefazHtml = {};
  if (!html || typeof html !== 'string') return resultado;

  // 1. Extração do Valor Total da Nota
  // Padrões comuns em portais da SEFAZ:
  // - "Valor a pagar R$ 123,45" ou "Valor a pagar: R$ 123,45"
  // - "Valor total R$ 123,45" ou "Valor Total: R$ 123,45"
  // - <span class="totalNFe">...<span class="vlr">123,45</span>...</span>
  // - <div id="linhaTotal">...R$ 123,45...</div>
  // - "Vl. Total" ou "VALOR TOTAL"
  const regexValorTotal = [
    /(?:Valor\s+a\s+pagar|Valor\s+total|Total\s+a\s+pagar|Vl\.\s*Total|VALOR\s+TOTAL)\s*(?:R\$|:|\s)*\s*([\d\.]+,\d{2})/i,
    /class=["'](?:totalNFe|vlr|valor|txtTotal)["'][^>]*>[\s\S]*?(?:R\$)?\s*([\d\.]+,\d{2})/i,
    /<td[^>]*>(?:Valor\s+Total|Valor\s+a\s+Pagar)<\/td>\s*<td[^>]*>[\s\S]*?([\d\.]+,\d{2})<\/td>/i,
    /(?:R\$\s*)([\d\.]+,\d{2})/i,
  ];

  for (const reg of regexValorTotal) {
    const m = html.match(reg);
    if (m && m[1]) {
      const valorStr = m[1].replace(/\./g, '').replace(',', '.');
      const vNum = parseFloat(valorStr);
      if (!isNaN(vNum) && vNum > 0 && vNum < 10000000) {
        resultado.valorTotal = vNum;
        break;
      }
    }
  }

  // 2. Extração da Razão Social / Nome Fantasia do Estabelecimento
  // Padrões comuns em portais da SEFAZ:
  // - <div class="txtTopo">PADARIA E CONFEITARIA LTDA</div>
  // - <div id="u20" class="txtTopo">...</div>
  // - <span class="txtNomeFantasia">...</span>
  // - <td class="campo_titulo">Nome / Razão Social:</td><td>...</td>
  const regexNome = [
    /class=["']txtTopo["'][^>]*>\s*([^<]+?)\s*<\/div>/i,
    /class=["'](?:txtNomeFantasia|razaoSocial|nomeEmitente)["'][^>]*>\s*([^<]+?)\s*<\//i,
    /<(?:td|div|span)[^>]*>(?:Razão\s+Social|Nome\s+Fantasia|Emitente)[:\s]*<\/(?:td|div|span)>\s*<(?:td|div|span)[^>]*>\s*([^<]+?)\s*<\//i,
  ];

  for (const reg of regexNome) {
    const m = html.match(reg);
    if (m && m[1]) {
      const nomeLimpo = m[1].replace(/\s+/g, ' ').trim();
      if (nomeLimpo.length >= 3 && !nomeLimpo.includes('SEFAZ') && !nomeLimpo.includes('Secretaria')) {
        resultado.razaoSocial = nomeLimpo;
        break;
      }
    }
  }

  // 3. Extração da Data de Emissão (DD/MM/AAAA)
  const regexData = [
    /(?:Emissão|Data\s+de\s+Emissão|Data\s+Emissão)[:\s]*\s*(\d{2})\/(\d{2})\/(\d{4})/i,
    /(\d{2})\/(\d{2})\/(\d{4})\s+\d{2}:\d{2}:\d{2}/,
  ];

  for (const reg of regexData) {
    const m = html.match(reg);
    if (m && m[1] && m[2] && m[3]) {
      resultado.dataEmissao = `${m[3]}-${m[2]}-${m[1]}`;
      break;
    }
  }

  return resultado;
}

/**
 * Consulta a URL da SEFAZ via HTTP com timeout controlado e extrai informações da página HTML.
 */
export async function consultarPortalSefaz(url: string, timeoutMs: number = 4000): Promise<DadosExtraidosSefazHtml | null> {
  if (!url || !url.startsWith('http')) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (!res.ok) {
      return null;
    }

    const html = await res.text();
    return parseHtmlSefazNfce(html);
  } catch {
    // Timeout, erro de rede ou SSL do portal estadual
    return null;
  } finally {
    clearTimeout(timer);
  }
}

