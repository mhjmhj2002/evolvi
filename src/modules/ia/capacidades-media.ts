/**
 * Capacidades multimídia por provedor de IA.
 *
 * Fonte única de verdade usada tanto pelo extrator de importação
 * (`ia-extrator.client.ts`) quanto pelo status de provedores (`GET /api/ia/status`),
 * evitando duplicar informação no frontend.
 */
export interface IaCapacidadeMedia {
  provedor: string;
  suportaImagens: boolean;
  suportaPdfsNaoEstruturados: boolean;
  descricao: string;
}

export const IA_CAPACIDADES_MEDIA: Record<string, IaCapacidadeMedia> = {
  GEMINI: {
    provedor: 'GEMINI',
    suportaImagens: true,
    suportaPdfsNaoEstruturados: true,
    descricao: 'Google Gemini (Multimodal nativo com suporte a imagens, visão computacional e PDFs)',
  },
  DEEPSEEK: {
    provedor: 'DEEPSEEK',
    suportaImagens: false,
    suportaPdfsNaoEstruturados: false,
    descricao: 'DeepSeek (Modelo puramente textual - requer texto legível, CSV, OFX ou PDFs textuais)',
  },
  OPENAI: {
    provedor: 'OPENAI',
    suportaImagens: true,
    suportaPdfsNaoEstruturados: true,
    descricao: 'OpenAI GPT-4o / Vision (Multimodal com suporte a visão e texto)',
  },
  CLAUDE: {
    provedor: 'CLAUDE',
    suportaImagens: true,
    suportaPdfsNaoEstruturados: true,
    descricao: 'Anthropic Claude 3.5 (Multimodal com suporte a visão e texto)',
  },
  OPENROUTER: {
    provedor: 'OPENROUTER',
    suportaImagens: true,
    suportaPdfsNaoEstruturados: true,
    descricao:
      'OpenRouter (catálogo multi-provedor, compatível com OpenAI: imagens via image_url em base64 e PDFs via content type "file")',
  },
};

/** Aliases aceitos entre o rótulo de provedor da API e a chave da tabela de capacidades. */
const ALIAS_CAPACIDADE: Record<string, string> = {
  ANTHROPIC: 'CLAUDE',
};

/**
 * Resolve a capacidade de mídia de um provedor (case-insensitive, com aliases).
 * Retorna `null` quando o provedor não é conhecido.
 */
export function obterCapacidadeMedia(provedor?: string | null): IaCapacidadeMedia | null {
  const prov = (provedor || '').trim().toUpperCase();
  if (!prov) return null;
  const chave = IA_CAPACIDADES_MEDIA[prov] ? prov : ALIAS_CAPACIDADE[prov];
  return chave ? IA_CAPACIDADES_MEDIA[chave] : null;
}
