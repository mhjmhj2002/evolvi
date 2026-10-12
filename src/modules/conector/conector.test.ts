import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { UniversalStatementParser } from './parsers/universal-statement.parser.js';
import { BankConnectorFactory } from './factory/bank-connector.factory.js';

describe('Hub de Conectores Bancários e Open Finance (TASK-15)', () => {
  let app: FastifyInstance;
  let tokenUser: string;
  let usuarioId: string;
  let contaId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Criar usuário para os testes
    const email = `teste.hub.${Date.now()}@exemplo.com`;
    const resCadastro = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario Hub Teste',
        email,
        senha: 'senhaSuperSegura123!',
        rendaBaseMensal: 6000.0,
      },
    });

    const bodyCadastro = JSON.parse(resCadastro.body);
    tokenUser = bodyCadastro.token;
    usuarioId = bodyCadastro.usuario.id;

    // Criar conta corrente para testes de importação
    const resConta = await app.inject({
      method: 'POST',
      url: '/api/contas',
      headers: { authorization: `Bearer ${tokenUser}` },
      payload: {
        nome: 'Conta Corrente Hub',
        tipo: 'CONTA_CORRENTE',
        saldoInicial: 1000.0,
      },
    });
    const bodyConta = JSON.parse(resConta.body);
    contaId = bodyConta.conta.id;
  });

  afterAll(async () => {
    if (usuarioId) {
      await prisma.movimento.deleteMany({ where: { usuarioId } });
      await prisma.conexaoBancaria.deleteMany({ where: { usuarioId } });
      await prisma.conta.deleteMany({ where: { usuarioId } });
      await prisma.usuario.deleteMany({ where: { id: usuarioId } });
    }
    await app.close();
  });

  describe('1. UniversalStatementParser', () => {
    const parser = new UniversalStatementParser();

    it('deve fazer parse de extrato OFX identificando data, valor e anti-dupla contagem de fatura', () => {
      const conteudoOFX = `
OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>20261011120000
<LANGUAGE>POR
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1001
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>341
<ACCTID>12345-6
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20261001000000
<DTEND>20261011000000
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261005120000
<TRNAMT>-150.25
<FITID>OFX_TX_001
<MEMO>SUPERMERCADO DIA
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261006120000
<TRNAMT>2500.00
<FITID>OFX_TX_002
<MEMO>PIX RECEBIDO PROVENTOS
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261008120000
<TRNAMT>-890.00
<FITID>OFX_TX_003
<MEMO>PAGAMENTO FATURA CARTAO ITAU
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
      `;

      const resultado = parser.parse(conteudoOFX, 'extrato.ofx');

      expect(resultado.formato).toBe('OFX');
      expect(resultado.transacoes.length).toBe(3);

      // Despesa comum
      expect(resultado.transacoes[0].data).toBe('2026-10-05');
      expect(resultado.transacoes[0].valor).toBe(150.25);
      expect(resultado.transacoes[0].natureza).toBe('DESPESA');

      // Receita
      expect(resultado.transacoes[1].data).toBe('2026-10-06');
      expect(resultado.transacoes[1].valor).toBe(2500.0);
      expect(resultado.transacoes[1].natureza).toBe('RECEITA');

      // Pagamento de fatura deve ser TRANSFERENCIA_PROPRIA para evitar dupla contagem
      expect(resultado.transacoes[2].data).toBe('2026-10-08');
      expect(resultado.transacoes[2].valor).toBe(890.0);
      expect(resultado.transacoes[2].natureza).toBe('TRANSFERENCIA_PROPRIA');
      expect(resultado.transacoes[2].isPagamentoFatura).toBe(true);
    });

    it('deve fazer parse de extrato CSV brasileiro com delimitador ponto-e-vírgula', () => {
      const conteudoCSV = `Data;Descricao;Valor
01/10/2026;Restaurante Sabor;R$ -45,90
02/10/2026;TED Recebida;R$ 1.200,00
03/10/2026;Pagamento de Fatura;R$ -650,00`;

      const resultado = parser.parse(conteudoCSV, 'extrato.csv');

      expect(resultado.formato).toBe('CSV');
      expect(resultado.transacoes.length).toBe(3);
      expect(resultado.transacoes[0].data).toBe('2026-10-01');
      expect(resultado.transacoes[0].valor).toBe(45.9);
      expect(resultado.transacoes[0].natureza).toBe('DESPESA');

      expect(resultado.transacoes[1].data).toBe('2026-10-02');
      expect(resultado.transacoes[1].valor).toBe(1200.0);
      expect(resultado.transacoes[1].natureza).toBe('RECEITA');

      expect(resultado.transacoes[2].data).toBe('2026-10-03');
      expect(resultado.transacoes[2].natureza).toBe('TRANSFERENCIA_PROPRIA');
    });
  });

  describe('2. BankConnectorFactory e Catálogo de Instituições', () => {
    it('deve listar todas as instituições homologadas no catálogo Open Finance', () => {
      const instituicoes = BankConnectorFactory.listSupportedInstitutions();
      expect(instituicoes.length).toBeGreaterThanOrEqual(10);

      const itau = instituicoes.find((i) => i.codigo === '341');
      const nubank = instituicoes.find((i) => i.codigo === '260');
      const bradesco = instituicoes.find((i) => i.codigo === '237');

      expect(itau).toBeDefined();
      expect(itau?.nome).toContain('Itaú');
      expect(nubank).toBeDefined();
      expect(bradesco).toBeDefined();
    });

    it('deve obter provedor para instituição pelo código COMPE ou apelido', () => {
      const provider = BankConnectorFactory.getProvider('341');
      expect(provider).toBeDefined();
      expect(provider.codigo).toBe('341');
    });
  });

  describe('3. Rotas REST do Hub de Conectores Bancários', () => {
    let conexaoCriadaId: string;

    it('GET /api/conectores/instituicoes deve retornar lista de bancos suportados', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/conectores/instituicoes',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.instituicoes)).toBe(true);
      expect(body.instituicoes.some((b: any) => b.codigo === 'CON-HUB')).toBe(true);
    });

    it('POST /api/conectores/conexoes deve conectar um banco e salvar no banco de dados', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/conectores/conexoes',
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          instituicaoCodigo: 'CON-HUB',
          credentials: { clientId: 'teste-hub-client' },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.conexao).toBeDefined();
      expect(body.conexao.status).toBe('CONECTADO');
      expect(body.conexao.instituicaoCodigo).toBe('CON-HUB');
      conexaoCriadaId = body.conexao.id;
    });

    it('GET /api/conectores/conexoes deve listar as conexões salvas do usuário', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/conectores/conexoes',
        headers: { authorization: `Bearer ${tokenUser}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.conexoes)).toBe(true);
      expect(body.conexoes.length).toBeGreaterThanOrEqual(1);
      expect(body.conexoes[0].id).toBe(conexaoCriadaId);
    });

    it('POST /api/conectores/conexoes/:id/sincronizar deve buscar contas e transações com deduplicação', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/conectores/conexoes/${conexaoCriadaId}/sincronizar`,
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          dataInicio: '2026-10-01',
          dataFim: '2026-10-15',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.conexaoId).toBe(conexaoCriadaId);
      expect(body.resumo.novosMovimentosInseridos).toBeGreaterThan(0);

      // Sincronizar novamente para validar a deduplicação
      const resSegunda = await app.inject({
        method: 'POST',
        url: `/api/conectores/conexoes/${conexaoCriadaId}/sincronizar`,
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          dataInicio: '2026-10-01',
          dataFim: '2026-10-15',
        },
      });

      const bodySegunda = JSON.parse(resSegunda.body);
      expect(bodySegunda.resumo.novosMovimentosInseridos).toBe(0);
      expect(bodySegunda.resumo.movimentosIgnoradosDedupe).toBeGreaterThan(0);
    });

    it('POST /api/conectores/importar-extrato deve receber conteúdo de extrato e gravar na conta informada', async () => {
      const csvContent = `Data;Descricao;Valor
10/10/2026;Lanche Padaria;-18,50
11/10/2026;Salário Mensal;4000,00`;

      const res = await app.inject({
        method: 'POST',
        url: '/api/conectores/importar-extrato',
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          contaId,
          content: csvContent,
          filename: 'extrato_manual.csv',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.resultado.novosInseridos).toBe(2);
      expect(body.resultado.formato).toBe('CSV');

      // Reimportação do mesmo conteúdo deve ser ignorada por dedupe
      const resReimport = await app.inject({
        method: 'POST',
        url: '/api/conectores/importar-extrato',
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          contaId,
          content: csvContent,
          filename: 'extrato_manual.csv',
        },
      });

      const bodyReimport = JSON.parse(resReimport.body);
      expect(bodyReimport.resultado.novosInseridos).toBe(0);
      expect(bodyReimport.resultado.duplicadasIgnoradas).toBe(2);
    });

    it('DELETE /api/conectores/conexoes/:id deve revogar a conexão bancária com segurança', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/conectores/conexoes/${conexaoCriadaId}`,
        headers: { authorization: `Bearer ${tokenUser}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.conexao.status).toBe('REVOGADO');
    });
  });

  describe('4. Conector Especializado Itaú Unibanco (TASK-16)', () => {
    let conexaoItauId: string;

    it('deve obter o conector Itaú especializado a partir do código COMPE 341 ou CON-ITAU', () => {
      const providerPorCompe = BankConnectorFactory.getProvider('341');
      const providerPorAlias = BankConnectorFactory.getProvider('CON-ITAU');

      expect(providerPorCompe.codigo).toBe('341');
      expect(providerPorCompe.nome).toBe('Itaú Unibanco');
      expect(providerPorCompe.compe).toBe('341');
      expect(providerPorAlias.codigo).toBe('341');
    });

    it('deve classificar transações típicas de extrato Itaú atribuindo categorias POF e anti-dupla contagem', () => {
      const provider = BankConnectorFactory.getProvider('341') as any;

      // Anti-dupla contagem em pagamento de fatura
      const fatura1 = provider.constructor.classificarTransacaoItau('PAGTO ELETRON COBRANCA ITAUCARD');
      expect(fatura1.natureza).toBe('TRANSFERENCIA_PROPRIA');
      expect(fatura1.isPagamentoFatura).toBe(true);

      const fatura2 = provider.constructor.classificarTransacaoItau('PAGAMENTO DE FATURA CARTAO');
      expect(fatura2.natureza).toBe('TRANSFERENCIA_PROPRIA');
      expect(fatura2.isPagamentoFatura).toBe(true);

      // Despesas de supermercado / alimentação
      const alim = provider.constructor.classificarTransacaoItau('COMPRA SUPERMERCADO PAO DE ACUCAR');
      expect(alim.natureza).toBe('DESPESA');
      expect(alim.categoriaSugerida).toBe('Alimentação');

      // Transporte
      const transp = provider.constructor.classificarTransacaoItau('POSTO IPIRANGA COMBUSTIVEL');
      expect(transp.natureza).toBe('DESPESA');
      expect(transp.categoriaSugerida).toBe('Transporte');

      // Tarifas Itaú
      const tarifa = provider.constructor.classificarTransacaoItau('TAR MENS PACOTE ITAU');
      expect(tarifa.natureza).toBe('DESPESA');
      expect(tarifa.categoriaSugerida).toBe('Serviços Bancários e Financeiros');

      // Receita
      const salario = provider.constructor.classificarTransacaoItau('TED RECEBIDA SALARIO EMPRESA');
      expect(salario.natureza).toBe('RECEITA');
      expect(salario.categoriaSugerida).toBe('Rendimento do Trabalho');
    });

    it('POST /api/conectores/conexoes deve conectar o Itaú com agência/conta e persistir consentimento', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/conectores/conexoes',
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          instituicaoCodigo: '341',
          credentials: {
            agencia: '0910',
            conta: '54321-0',
          },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.conexao.instituicaoCodigo).toBe('341');
      expect(body.conexao.instituicaoNome).toBe('Itaú Unibanco');
      expect(body.conexao.compe).toBe('341');
      expect(body.conexao.status).toBe('CONECTADO');
      conexaoItauId = body.conexao.id;
    });

    it('POST /api/conectores/conexoes/:id/sincronizar deve sincronizar conta corrente e cartão Itaucard com deduplicação', async () => {
      const resSync = await app.inject({
        method: 'POST',
        url: `/api/conectores/conexoes/${conexaoItauId}/sincronizar`,
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          dataInicio: '2026-10-01',
          dataFim: '2026-10-15',
        },
      });

      expect(resSync.statusCode).toBe(200);
      const bodySync = JSON.parse(resSync.body);
      expect(bodySync.conexaoId).toBe(conexaoItauId);
      expect(bodySync.instituicaoNome).toBe('Itaú Unibanco');
      expect(bodySync.contasProcessadas.length).toBe(2);
      expect(bodySync.resumo.novosMovimentosInseridos).toBeGreaterThan(0);

      // Validar contas criadas no banco de dados para o Itaú
      const contasItau = await prisma.conta.findMany({
        where: { usuarioId, nome: { contains: 'Itaú' } },
      });
      expect(contasItau.length).toBeGreaterThanOrEqual(1);

      // Re-sincronizar e validar deduplicação 100% garantida
      const resReSync = await app.inject({
        method: 'POST',
        url: `/api/conectores/conexoes/${conexaoItauId}/sincronizar`,
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          dataInicio: '2026-10-01',
          dataFim: '2026-10-15',
        },
      });

      const bodyReSync = JSON.parse(resReSync.body);
      expect(bodyReSync.resumo.novosMovimentosInseridos).toBe(0);
      expect(bodyReSync.resumo.movimentosIgnoradosDedupe).toBeGreaterThan(0);

      // Validar que o pagamento de fatura Itaú foi gravado com TRANSFERENCIA_PROPRIA
      const movFatura = await prisma.movimento.findFirst({
        where: {
          usuarioId,
          descricao: { contains: 'PAGTO ELETRON COBRANCA ITAUCARD' },
        },
      });
      expect(movFatura).toBeDefined();
      expect(movFatura?.natureza).toBe('TRANSFERENCIA_PROPRIA');
    });
  });

  describe('5. Conector Especializado Santander Brasil (TASK-17)', () => {
    let conexaoSantanderId: string;

    it('deve resolver o SantanderBankConnectorProvider por COMPE 033 e por alias CON-SANTANDER', () => {
      const providerCompe = BankConnectorFactory.getProvider('033');
      const providerAlias = BankConnectorFactory.getProvider('CON-SANTANDER');

      expect(providerCompe).toBeDefined();
      expect(providerCompe.codigo).toBe('033');
      expect(providerCompe.nome).toBe('Santander');
      expect(providerCompe.compe).toBe('033');
      expect(providerCompe).toBe(providerAlias);
    });

    it('deve classificar transações típicas do Santander e aplicar anti-dupla contagem no pagamento de fatura Way', () => {
      const provider = BankConnectorFactory.getProvider('033') as any;

      // Pagamento de fatura Santander Way (anti-dupla contagem)
      const faturaWay = provider.constructor.classificarTransacaoSantander('DEB AUT CARTAO SANTANDER WAY');
      expect(faturaWay.natureza).toBe('TRANSFERENCIA_PROPRIA');
      expect(faturaWay.isPagamentoFatura).toBe(true);

      const pagtoTit = provider.constructor.classificarTransacaoSantander('PAGTO TIT BCO SANTANDER');
      expect(pagtoTit.natureza).toBe('TRANSFERENCIA_PROPRIA');

      // Alimentação
      const mercado = provider.constructor.classificarTransacaoSantander('CARREFOUR HIPERMERCADO');
      expect(mercado.natureza).toBe('DESPESA');
      expect(mercado.categoriaSugerida).toBe('Alimentação');

      // Transporte
      const uber = provider.constructor.classificarTransacaoSantander('UBER TRIP BRASIL');
      expect(uber.natureza).toBe('DESPESA');
      expect(uber.categoriaSugerida).toBe('Transporte');

      // Tarifas bancárias Santander
      const tarifa = provider.constructor.classificarTransacaoSantander('TAR MENSALIDADE PACOTE SANTANDER');
      expect(tarifa.natureza).toBe('DESPESA');
      expect(tarifa.categoriaSugerida).toBe('Serviços Bancários e Financeiros');

      // Proventos / Salário
      const salario = provider.constructor.classificarTransacaoSantander('CRED SALARIO EMPRESA S.A.');
      expect(salario.natureza).toBe('RECEITA');
      expect(salario.categoriaSugerida).toBe('Rendimento do Trabalho');
    });

    it('POST /api/conectores/conexoes deve conectar o Santander com agência/conta e persistir consentimento', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/conectores/conexoes',
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          instituicaoCodigo: '033',
          credentials: {
            agencia: '2041',
            conta: '88765-4',
          },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.conexao.instituicaoCodigo).toBe('033');
      expect(body.conexao.instituicaoNome).toBe('Santander');
      expect(body.conexao.compe).toBe('033');
      expect(body.conexao.status).toBe('CONECTADO');
      conexaoSantanderId = body.conexao.id;
    });

    it('POST /api/conectores/conexoes/:id/sincronizar deve sincronizar conta corrente e cartão Santander SX com deduplicação', async () => {
      const resSync = await app.inject({
        method: 'POST',
        url: `/api/conectores/conexoes/${conexaoSantanderId}/sincronizar`,
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          dataInicio: '2026-10-01',
          dataFim: '2026-10-15',
        },
      });

      expect(resSync.statusCode).toBe(200);
      const bodySync = JSON.parse(resSync.body);
      expect(bodySync.conexaoId).toBe(conexaoSantanderId);
      expect(bodySync.instituicaoNome).toBe('Santander');
      expect(bodySync.contasProcessadas.length).toBe(2);
      expect(bodySync.resumo.novosMovimentosInseridos).toBeGreaterThan(0);

      // Validar contas criadas no banco de dados para o Santander
      const contasSantander = await prisma.conta.findMany({
        where: { usuarioId, nome: { contains: 'Santander' } },
      });
      expect(contasSantander.length).toBeGreaterThanOrEqual(1);

      // Re-sincronizar e validar deduplicação 100% garantida
      const resReSync = await app.inject({
        method: 'POST',
        url: `/api/conectores/conexoes/${conexaoSantanderId}/sincronizar`,
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          dataInicio: '2026-10-01',
          dataFim: '2026-10-15',
        },
      });

      const bodyReSync = JSON.parse(resReSync.body);
      expect(bodyReSync.resumo.novosMovimentosInseridos).toBe(0);
      expect(bodyReSync.resumo.movimentosIgnoradosDedupe).toBeGreaterThan(0);

      // Validar que o pagamento de fatura Santander foi gravado com TRANSFERENCIA_PROPRIA
      const movFatura = await prisma.movimento.findFirst({
        where: {
          usuarioId,
          descricao: { contains: 'DEB AUT CARTAO SANTANDER WAY' },
        },
      });
      expect(movFatura).toBeDefined();
      expect(movFatura?.natureza).toBe('TRANSFERENCIA_PROPRIA');
    });
  });

  describe('5. Integração Especializada Banco Inter (TASK-18)', () => {
    let conexaoInterId: string;

    it('deve resolver o InterBankConnectorProvider por COMPE 077 e por alias CON-INTER', () => {
      const providerCompe = BankConnectorFactory.getProvider('077');
      const providerAlias = BankConnectorFactory.getProvider('CON-INTER');

      expect(providerCompe).toBeDefined();
      expect(providerCompe.codigo).toBe('077');
      expect(providerCompe.nome).toBe('Banco Inter');
      expect(providerCompe.compe).toBe('077');
      expect(providerCompe).toBe(providerAlias);
    });

    it('deve classificar transações típicas do Inter e aplicar anti-dupla contagem no pagamento de fatura', () => {
      const provider = BankConnectorFactory.getProvider('077') as any;

      // Pagamento de fatura Inter Mastercard (anti-dupla contagem)
      const faturaInter = provider.constructor.classificarTransacaoInter('PAGTO FATURA INTER MASTERCARD');
      expect(faturaInter.natureza).toBe('TRANSFERENCIA_PROPRIA');
      expect(faturaInter.isPagamentoFatura).toBe(true);

      const debAutInter = provider.constructor.classificarTransacaoInter('DEB AUT CARTAO INTER');
      expect(debAutInter.natureza).toBe('TRANSFERENCIA_PROPRIA');

      // Cashback Inter Shop
      const cashback = provider.constructor.classificarTransacaoInter('INTER SHOP CASHBACK COMPRA');
      expect(cashback.natureza).toBe('RECEITA');
      expect(cashback.categoriaSugerida).toBe('Rendimento do Trabalho');

      // Proventos / Salário
      const salario = provider.constructor.classificarTransacaoInter('CRED SALARIO EMPRESA TECNOLOGIA');
      expect(salario.natureza).toBe('RECEITA');
      expect(salario.categoriaSugerida).toBe('Rendimento do Trabalho');

      // Alimentação / Delivery
      const mercado = provider.constructor.classificarTransacaoInter('SUPERMERCADO CARREFOUR');
      expect(mercado.natureza).toBe('DESPESA');
      expect(mercado.categoriaSugerida).toBe('Alimentação');

      // Transporte
      const shell = provider.constructor.classificarTransacaoInter('POSTO SHELL COMBUSTIVEL');
      expect(shell.natureza).toBe('DESPESA');
      expect(shell.categoriaSugerida).toBe('Transporte');

      // Farmácia
      const farmacia = provider.constructor.classificarTransacaoInter('DROGARIA ARAUJO FARMACIA');
      expect(farmacia.natureza).toBe('DESPESA');
      expect(farmacia.categoriaSugerida).toBe('Saúde e Cuidados Pessoais');
    });

    it('POST /api/conectores/conexoes deve conectar o Banco Inter e persistir consentimento', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/conectores/conexoes',
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          instituicaoCodigo: '077',
          credentials: {
            contaCorrente: '1234567-8',
            chavePix: '123.456.789-00',
          },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.conexao.instituicaoCodigo).toBe('077');
      expect(body.conexao.instituicaoNome).toBe('Banco Inter');
      expect(body.conexao.compe).toBe('077');
      expect(body.conexao.status).toBe('CONECTADO');
      conexaoInterId = body.conexao.id;
    });

    it('POST /api/conectores/conexoes/:id/sincronizar deve sincronizar conta corrente e cartão Inter Black com deduplicação', async () => {
      const resSync = await app.inject({
        method: 'POST',
        url: `/api/conectores/conexoes/${conexaoInterId}/sincronizar`,
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          dataInicio: '2026-10-01',
          dataFim: '2026-10-15',
        },
      });

      expect(resSync.statusCode).toBe(200);
      const bodySync = JSON.parse(resSync.body);
      expect(bodySync.conexaoId).toBe(conexaoInterId);
      expect(bodySync.instituicaoNome).toBe('Banco Inter');
      expect(bodySync.contasProcessadas.length).toBe(2);
      expect(bodySync.resumo.novosMovimentosInseridos).toBeGreaterThan(0);

      // Validar contas criadas no banco de dados para o Inter
      const contasInter = await prisma.conta.findMany({
        where: { usuarioId, nome: { contains: 'Inter' } },
      });
      expect(contasInter.length).toBeGreaterThanOrEqual(1);

      // Re-sincronizar e validar deduplicação 100% garantida
      const resReSync = await app.inject({
        method: 'POST',
        url: `/api/conectores/conexoes/${conexaoInterId}/sincronizar`,
        headers: { authorization: `Bearer ${tokenUser}` },
        payload: {
          dataInicio: '2026-10-01',
          dataFim: '2026-10-15',
        },
      });

      const bodyReSync = JSON.parse(resReSync.body);
      expect(bodyReSync.resumo.novosMovimentosInseridos).toBe(0);
      expect(bodyReSync.resumo.movimentosIgnoradosDedupe).toBeGreaterThan(0);

      // Validar que o pagamento de fatura Inter foi gravado com TRANSFERENCIA_PROPRIA
      const movFatura = await prisma.movimento.findFirst({
        where: {
          usuarioId,
          descricao: { contains: 'PAGTO FATURA INTER MASTERCARD' },
        },
      });
      expect(movFatura).toBeDefined();
      expect(movFatura?.natureza).toBe('TRANSFERENCIA_PROPRIA');
    });
  });
});
