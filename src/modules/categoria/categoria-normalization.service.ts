export interface CategoryWeightItem {
  id: string;
  nome: string;
  pesoBrutoReferencia: number | string | null;
  [key: string]: unknown;
}

/**
 * Normaliza uma lista de categorias com base em seus pesos brutos de referência
 * para que a soma dos percentuais normalizados feche exatamente em 100,00%.
 *
 * Utiliza o algoritmo de Maior Resto (Largest Remainder / Hare-Niemeyer)
 * com aritmética inteira de centésimos (100.00% = 10000) para garantir
 * fechamento exato em 100.00 sem erros de ponto flutuante.
 */
export function normalizarCestaCategorias<T extends CategoryWeightItem>(
  categorias: T[]
): (T & { referenciaNormalizadaPct: number })[] {
  if (!categorias || categorias.length === 0) {
    return [];
  }

  // 1. Converter pesos para número seguro e somar
  const pesosNumericos = categorias.map((c) => {
    const val = Number(c.pesoBrutoReferencia);
    return isNaN(val) || val < 0 ? 0 : val;
  });

  const somaPesosBrutos = pesosNumericos.reduce((acc, p) => acc + p, 0);

  // Se a soma for zero, divide igualmente entre todas
  if (somaPesosBrutos <= 0) {
    const totalCount = categorias.length;
    const baseCents = Math.floor(10000 / totalCount);
    let diff = 10000 - baseCents * totalCount;

    return categorias.map((cat, idx) => {
      let cents = baseCents;
      if (idx < diff) {
        cents += 1;
      }
      return {
        ...cat,
        referenciaNormalizadaPct: Number((cents / 100).toFixed(2)),
      };
    });
  }

  // 2. Calcular cotas em centésimos (100.00% = 10000 unidades)
  interface ItemCota {
    cat: T;
    cents: number;
    remainder: number;
    index: number;
  }

  const cotas: ItemCota[] = categorias.map((cat, index) => {
    const peso = pesosNumericos[index];
    if (peso <= 0) {
      return { cat, cents: 0, remainder: 0, index };
    }

    // percentual exato * 100 = (peso / somaPesos) * 10000
    const rawCents = (peso / somaPesosBrutos) * 10000;
    const integerCents = Math.floor(rawCents);
    const remainder = rawCents - integerCents;

    return {
      cat,
      cents: integerCents,
      remainder,
      index,
    };
  });

  // 3. Soma das partes inteiras
  const somaCents = cotas.reduce((acc, c) => acc + c.cents, 0);
  const diffCents = 10000 - somaCents;

  // 4. Ordenar índices com maiores restos para distribuir a diferença
  const indicesOrdenados = [...cotas]
    .filter((c) => c.cents > 0 || c.remainder > 0)
    .sort((a, b) => {
      if (b.remainder !== a.remainder) {
        return b.remainder - a.remainder;
      }
      return a.index - b.index;
    })
    .map((c) => c.index);

  const bonusIndices = new Set(indicesOrdenados.slice(0, diffCents));

  // 5. Retornar categorias com percentual normalizado
  return cotas.map((c) => {
    let finalCents = c.cents;
    if (bonusIndices.has(c.index)) {
      finalCents += 1;
    }
    const finalPct = Number((finalCents / 100).toFixed(2));

    return {
      ...c.cat,
      referenciaNormalizadaPct: finalPct,
    };
  });
}
