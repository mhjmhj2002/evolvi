export interface RegraCombinatoria {
  id: string;
  nome: string;
  padraoDescricao: RegExp;
  diasSemana?: number[]; // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado. Se omitido, qualquer dia.
  categoriaPofSugerida: string;
  confianca: number; // 0 a 1
  explicacao?: string;
}

export interface ResultadoInferenciaCombinatoria {
  categoriaSugerida: string;
  confianca: number;
  regraId: string;
  diaSemana: number;
  explicacao: string;
}

/**
 * Catálogo de regras combinatórias determinísticas.
 * Combina palavras-chave/raízes de estabelecimentos com padrões temporais (dia da semana, etc.)
 */
export const REGRAS_COMBINATORIAS_PADRAO: RegraCombinatoria[] = [
  {
    id: 'FEIRA_FIM_DE_SEMANA',
    nome: 'Feira / Hortifrúti / Barraca em Fim de Semana',
    // Ex: "Barraca do Julio", "Feira Livre", "Hortifruti", "Feirinha da Vila", "Barraca de Pastel"
    padraoDescricao: /(?:\b|^)(?:barraca|feira|feirinha|hortifruti|hortifr[uú]ti|sacol[aã]o|pastel\s*da\s*feira)(?:\b|$)/i,
    diasSemana: [0, 6], // Domingo (0) ou Sábado (6)
    categoriaPofSugerida: 'Alimentação',
    confianca: 0.95,
    explicacao: 'Estabelecimento de feira livre / hortifrúti em fim de semana possui alta correlação com Alimentação / Feira.',
  },
  {
    id: 'PADARIA_DOMINGO_MANHA',
    nome: 'Padaria e Confeitaria em Fim de Semana',
    padraoDescricao: /(?:\b|^)(?:padaria|panificadora|confeitaria|casa\s*do\s*p[aã]o)(?:\b|$)/i,
    diasSemana: [0, 6],
    categoriaPofSugerida: 'Alimentação',
    confianca: 0.95,
    explicacao: 'Despesa em padaria ou confeitaria aos finais de semana correlacionada à categoria de Alimentação.',
  },
  {
    id: 'HORTIFRUTI_DIAS_SEMANA',
    nome: 'Hortifrúti e Sacolão Geral',
    padraoDescricao: /(?:\b|^)(?:hortifruti|hortifr[uú]ti|sacol[aã]o|quitanda)(?:\b|$)/i,
    diasSemana: [1, 2, 3, 4, 5],
    categoriaPofSugerida: 'Alimentação',
    confianca: 0.90,
    explicacao: 'Compra de hortifrúti/sacolão em dias úteis correlacionada à categoria de Alimentação.',
  },
];

export class ClassificadorCombinatorioService {
  private regras: RegraCombinatoria[];

  constructor(regrasCustomizadas?: RegraCombinatoria[]) {
    this.regras = regrasCustomizadas || REGRAS_COMBINATORIAS_PADRAO;
  }

  /**
   * Avalia a descrição e a data do movimento para inferir a categoria combinatória.
   * @param descricao Texto do lançamento
   * @param dataMovimento Data em string YYYY-MM-DD ou objeto Date
   * @param valor Valor monetário opcional
   */
  public inferirCategoria(
    descricao: string,
    dataMovimento: string | Date,
    _valor?: number
  ): ResultadoInferenciaCombinatoria | null {
    if (!descricao || !descricao.trim()) {
      return null;
    }

    const textoDescricao = descricao.trim();

    // Normalização segura da data e extração do dia da semana (0 = domingo, 6 = sábado)
    // Atenção: para strings YYYY-MM-DD, ao usar new Date("YYYY-MM-DDT12:00:00Z") garantimos estabilidade de fuso
    let dateObj: Date;
    if (typeof dataMovimento === 'string') {
      const match = dataMovimento.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        dateObj = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
      } else {
        dateObj = new Date(dataMovimento);
      }
    } else {
      dateObj = dataMovimento;
    }

    const diaSemana = dateObj.getUTCDay();

    for (const regra of this.regras) {
      if (regra.diasSemana && !regra.diasSemana.includes(diaSemana)) {
        continue;
      }

      if (regra.padraoDescricao.test(textoDescricao)) {
        return {
          categoriaSugerida: regra.categoriaPofSugerida,
          confianca: regra.confianca,
          regraId: regra.id,
          diaSemana,
          explicacao: regra.explicacao || `Regra ${regra.nome} aplicada.`,
        };
      }
    }

    return null;
  }
}

export const classificadorCombinatorioService = new ClassificadorCombinatorioService();
