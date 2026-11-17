import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const diretorioModulo = path.dirname(fileURLToPath(import.meta.url));
const diretoriosSkills = [
  path.join(diretorioModulo, 'skills'),
  path.resolve(process.cwd(), 'src/modules/importacao/worker/skills'),
];

function carregarSkill(nome: string): string {
  for (const diretorio of diretoriosSkills) {
    const arquivo = path.join(diretorio, nome);
    if (fs.existsSync(arquivo)) return fs.readFileSync(arquivo, 'utf8').trim();
  }
  throw new Error(`Skill de extração não encontrada: ${nome}`);
}

const skills = {
  genericaExtrato: carregarSkill('generica-extrato.md'),
  genericaCartao: carregarSkill('generica-cartao.md'),
  santanderExtrato: carregarSkill('santander-extrato.md'),
  santanderCartao: carregarSkill('santander-cartao.md'),
  interExtrato: carregarSkill('inter-extrato.md'),
  interCartao: carregarSkill('inter-cartao.md'),
  c6Extrato: carregarSkill('c6-extrato.md'),
  c6Cartao: carregarSkill('c6-cartao.md'),
  nubankExtrato: carregarSkill('nubank-extrato.md'),
  nubankCartao: carregarSkill('nubank-cartao.md'),
  pagbankExtrato: carregarSkill('pagbank-extrato.md'),
  pagbankCartao: carregarSkill('pagbank-cartao.md'),
  mercadoPagoExtrato: carregarSkill('mercado-pago-extrato.md'),
  mercadoPagoCartao: carregarSkill('mercado-pago-cartao.md'),
};

export function obterInstrucoesSkillDocumento(params: {
  tipoDocumento: 'EXTRATO_CONTA' | 'FATURA_CARTAO' | 'OUTRO';
  chaveInstituicaoSkill: 'santander' | 'inter' | 'c6' | 'nubank' | 'pagbank' | 'mercadoPago' | null;
}): string {
  const cartao = params.tipoDocumento === 'FATURA_CARTAO';
  const chave = `${params.chaveInstituicaoSkill || 'generica'}${cartao ? 'Cartao' : 'Extrato'}` as keyof typeof skills;
  const generica = cartao ? skills.genericaCartao : skills.genericaExtrato;
  const especifica = params.tipoDocumento !== 'OUTRO' && params.chaveInstituicaoSkill ? skills[chave] : null;

  return [generica, especifica].filter(Boolean).join('\n\n');
}
