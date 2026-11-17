import path from 'node:path';
import { PdfTextExtractor } from '../../conector/parsers/pdf-text-extractor.js';

export type TipoDocumentoFinanceiro = 'EXTRATO_CONTA' | 'FATURA_CARTAO' | 'OUTRO';
export type ChaveInstituicaoSkill = 'santander' | 'inter' | 'c6' | 'nubank' | 'pagbank' | 'mercadoPago';

export interface ClassificacaoDocumentoWorker {
  instituicao: string | null;
  chaveInstituicaoSkill: ChaveInstituicaoSkill | null;
  tipoDocumento: TipoDocumentoFinanceiro;
  origemInstituicao: 'NOME_ARQUIVO' | 'CONTEUDO' | 'NAO_IDENTIFICADA';
  origemTipo: 'NOME_ARQUIVO' | 'CONTEUDO' | 'NAO_IDENTIFICADO';
  evidencia: string[];
}

const catalogoInstituicoes: { nomes: string[]; oficial: string; skill: ChaveInstituicaoSkill | null }[] = [
  { nomes: ['santander', 'banco santander'], oficial: 'Santander', skill: 'santander' },
  { nomes: ['banco inter', 'inter', 'inter.co'], oficial: 'Inter', skill: 'inter' },
  { nomes: ['c6 bank', 'c6bank', 'c6'], oficial: 'C6 Bank', skill: 'c6' },
  { nomes: ['nubank', 'nu pagamentos'], oficial: 'Nubank', skill: 'nubank' },
  { nomes: ['pagbank', 'pagseguro'], oficial: 'PagBank', skill: 'pagbank' },
  { nomes: ['mercado pago', 'mercadopago'], oficial: 'Mercado Pago', skill: 'mercadoPago' },
  { nomes: ['itau', 'itaú', 'banco itau'], oficial: 'Itaú', skill: null },
  { nomes: ['bradesco'], oficial: 'Bradesco', skill: null },
  { nomes: ['caixa economica', 'caixa econômica', 'caixa'], oficial: 'Caixa', skill: null },
  { nomes: ['banco do brasil', 'bb.com.br'], oficial: 'Banco do Brasil', skill: null },
  { nomes: ['sicredi'], oficial: 'Sicredi', skill: null },
  { nomes: ['sicoob'], oficial: 'Sicoob', skill: null },
  { nomes: ['btg pactual', 'btg'], oficial: 'BTG Pactual', skill: null },
  { nomes: ['stone'], oficial: 'Stone', skill: null },
  { nomes: ['neon'], oficial: 'Neon', skill: null },
];

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function encontrarInstituicao(texto: string, catalogoExtra: { nomeOficial: string; nomeReduzido: string; aliases?: unknown }[] = []) {
  const normalizado = normalizar(texto);
  const encontrada = catalogoInstituicoes.find((item) => item.nomes.some((nome) => {
    const termo = normalizar(nome);
    return new RegExp(`(^|[^a-z0-9])${termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(normalizado);
  }));
  if (encontrada) return encontrada;
  const adicional = catalogoExtra.find((item) => {
    const aliases = Array.isArray(item.aliases) ? item.aliases.filter((alias): alias is string => typeof alias === 'string') : [];
    return [item.nomeOficial, item.nomeReduzido, ...aliases].some((nome) => {
      const termo = normalizar(nome).trim();
      if (!termo) return false;
      return new RegExp(`(^|[^a-z0-9])${termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(normalizado);
    });
  });
  if (!adicional) return undefined;
  const habilitada = catalogoInstituicoes.find((item) => normalizar(item.oficial) === normalizar(adicional.nomeOficial));
  return { oficial: adicional.nomeOficial, skill: habilitada?.skill ?? null };
}

function tipoPeloNome(nome: string): TipoDocumentoFinanceiro | null {
  const texto = normalizar(path.basename(nome));
  if (/(^|[^a-z])(?:fatura|cartao|cartao-credito|invoice)([^a-z]|$)/.test(texto)) return 'FATURA_CARTAO';
  if (/(^|[^a-z])(?:extrato|statement|movimentacoes)([^a-z]|$)/.test(texto)) return 'EXTRATO_CONTA';
  return null;
}

function tipoPeloConteudo(texto: string, ehCsv: boolean): TipoDocumentoFinanceiro {
  const cabecalho = normalizar(texto.slice(0, 12_000));
  const sinaisFatura = [
    /fatura (?:do|de) cartao/, /resumo da fatura/, /total (?:da|a pagar).*vencimento/,
    /pagamento minimo/, /limite disponivel/, /despesas da fatura/, /lancamentos do cartao/,
  ].filter((regex) => regex.test(cabecalho)).length;
  if (sinaisFatura >= 2 || (sinaisFatura >= 1 && /(?:final|[*]{4}|cartao de credito)/.test(cabecalho))) return 'FATURA_CARTAO';
  const sinaisExtrato = [
    /extrato (?:de|da|do) (?:conta|movimentacoes|periodo)/, /saldo anterior/,
    /saldo disponivel/, /data.{0,40}descricao.{0,40}valor/, /lancamentos da conta/,
  ].filter((regex) => regex.test(cabecalho)).length;
  if (sinaisExtrato >= 1) return 'EXTRATO_CONTA';
  if (ehCsv) return 'EXTRATO_CONTA';
  return 'OUTRO';
}

/** Prioriza sempre o nome do arquivo; inspeciona texto de PDF/CSV apenas quando faltam dados. */
export function classificarDocumentoWorker(params: {
  nomeArquivo: string;
  conteudoBuffer: Buffer;
  instituicoes?: { nomeOficial: string; nomeReduzido: string; aliases?: unknown }[];
}): ClassificacaoDocumentoWorker {
  const ext = path.extname(params.nomeArquivo).toLowerCase();
  const texto = ext === '.pdf'
    ? PdfTextExtractor.extrairTexto(params.conteudoBuffer)
    : params.conteudoBuffer.toString('utf8');

  const instituicaoNome = encontrarInstituicao(params.nomeArquivo, params.instituicoes);
  const instituicaoTexto = instituicaoNome ? null : encontrarInstituicao(texto.slice(0, 12_000), params.instituicoes);
  const tipoNome = tipoPeloNome(params.nomeArquivo);
  const tipoTexto = tipoNome ? null : tipoPeloConteudo(texto, ext === '.csv');
  const instituicao = instituicaoNome || instituicaoTexto;
  const tipoDocumento = tipoNome || tipoTexto || 'OUTRO';

  return {
    instituicao: instituicao?.oficial ?? null,
    chaveInstituicaoSkill: instituicao?.skill ?? null,
    tipoDocumento,
    origemInstituicao: instituicaoNome ? 'NOME_ARQUIVO' : instituicaoTexto ? 'CONTEUDO' : 'NAO_IDENTIFICADA',
    origemTipo: tipoNome ? 'NOME_ARQUIVO' : tipoTexto && tipoTexto !== 'OUTRO' ? 'CONTEUDO' : 'NAO_IDENTIFICADO',
    evidencia: [
      instituicaoNome ? `Instituição encontrada no nome: ${instituicaoNome.oficial}` : null,
      instituicaoTexto ? `Instituição encontrada no conteúdo: ${instituicaoTexto.oficial}` : null,
      tipoNome ? `Tipo encontrado no nome: ${tipoNome}` : null,
      tipoTexto && tipoTexto !== 'OUTRO' ? `Tipo encontrado no conteúdo: ${tipoTexto}` : null,
    ].filter((item): item is string => Boolean(item)),
  };
}
