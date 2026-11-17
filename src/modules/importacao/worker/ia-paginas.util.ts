export interface TrechoDocumentoPaginado {
  pagina: number | null;
  texto: string;
}

/**
 * Preserva os limites de página do texto extraído. Quando a quantidade de
 * páginas textuais não corresponde ao total físico conhecido, não inventa a
 * associação: os trechos ficam sem página e a reconciliação bloqueará sucesso.
 */
export function dividirDocumentoEmPaginas(
  texto: string,
  paginasTotais: number | null,
): TrechoDocumentoPaginado[] {
  const temSeparadorPagina = texto.includes('\f');
  const textoSemSeparadorFinal = texto.replace(/\f+\s*$/u, '');
  const paginasTexto = temSeparadorPagina ? textoSemSeparadorFinal.split('\f') : [texto];

  if (paginasTotais == null) {
    return paginasTexto.map((paginaTexto, indice) => ({
      pagina: temSeparadorPagina ? indice + 1 : 1,
      texto: paginaTexto,
    }));
  }

  const limitesConferem = paginasTexto.length === paginasTotais;
  return paginasTexto.map((paginaTexto, indice) => ({
    pagina: limitesConferem ? indice + 1 : paginasTotais === 1 ? 1 : null,
    texto: paginaTexto,
  }));
}

export function dividirPaginaEmChunks(
  paginas: TrechoDocumentoPaginado[],
  tamanhoMaximo: number,
): TrechoDocumentoPaginado[] {
  const chunks: TrechoDocumentoPaginado[] = [];
  for (const pagina of paginas) {
    if (pagina.texto.length === 0) continue;
    let inicio = 0;
    while (inicio < pagina.texto.length) {
      let fim = Math.min(inicio + tamanhoMaximo, pagina.texto.length);
      if (fim < pagina.texto.length) {
        const quebra = pagina.texto.lastIndexOf('\n', fim);
        if (quebra > inicio + Math.floor(tamanhoMaximo * 0.6)) fim = quebra + 1;
      }
      chunks.push({ pagina: pagina.pagina, texto: pagina.texto.slice(inicio, fim) });
      inicio = fim;
    }
  }
  return chunks;
}
