import { describe, it, expect, beforeAll } from 'vitest';
import { buildApp } from '../../app.js';
import { FastifyInstance } from 'fastify';
import { buildIaSystemPrompt, parseLocalDeterministic, ContextoUsuarioIA } from './ia.service.js';

describe('Módulo de IA para Registro de Lançamentos (TASK-12)', () => {
  let app: FastifyInstance;
  let tokenAuth: string;

  const mockContexto: ContextoUsuarioIA = {
    contas: [
      { id: 'c-nubank', nome: 'Nubank Cartão', tipo: 'CARTAO_CREDITO' },
      { id: 'c-itau', nome: 'Itaú CC', tipo: 'CONTA_CORRENTE' },
    ],
    categorias: [
      { id: 'cat-alim', nome: 'Alimentação' },
      { id: 'cat-hab', nome: 'Habitação' },
      { id: 'cat-transp', nome: 'Transporte' },
    ],
    dataReferencia: '2026-10-11',
  };

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Cadastro e login para obter token de autenticação
    const email = `test-ia-${Date.now()}@exemplo.com`;
    const resCadastro = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: {
        nome: 'Usuario IA Teste',
        email,
        senha: 'SenhaSegura123!',
      },
    });

    const cookies = resCadastro.cookies;
    const tokenCookie = cookies.find((c) => c.name === 'token');
    tokenAuth = tokenCookie?.value || '';
  });

  describe('Unidade: Prompt Builder e Parser Determinístico', () => {
    it('deve gerar o system prompt completo com contas e categorias', () => {
      const prompt = buildIaSystemPrompt(mockContexto);
      expect(prompt).toContain('Evolvi');
      expect(prompt).toContain('Nubank Cartão');
      expect(prompt).toContain('Alimentação');
      expect(prompt).toContain('2026-10-11');
      expect(prompt).toContain('isPagamentoFatura');
    });

    it('deve interpretar despesa comum em linguagem natural', () => {
      const resultado = parseLocalDeterministic(
        'Almoço executivo no restaurante X R$ 45,50 no cartão Nubank',
        mockContexto
      );
      expect(resultado.valor).toBe(45.5);
      expect(resultado.natureza).toBe('DESPESA');
      expect(resultado.contaId).toBe('c-nubank');
      expect(resultado.categoriaId).toBe('cat-alim');
      expect(resultado.isPagamentoFatura).toBe(false);
    });

    it('deve identificar pagamento de fatura de cartão com anti-dupla contagem', () => {
      const resultado = parseLocalDeterministic(
        'Paguei a fatura do cartão de crédito Nubank R$ 1250,00',
        mockContexto
      );
      expect(resultado.valor).toBe(1250.0);
      expect(resultado.natureza).toBe('TRANSFERENCIA_PROPRIA');
      expect(resultado.isPagamentoFatura).toBe(true);
    });

    it('deve extrair informações de parcelamento quando mencionadas', () => {
      const resultado = parseLocalDeterministic(
        'Comprei pneu novo em 4x de R$ 150,00 no cartão',
        mockContexto
      );
      expect(resultado.parcelasTotal).toBe(4);
      expect(resultado.parcelaAtual).toBe(1);
    });
  });

  describe('Integração: Endpoints /api/ia', () => {
    it('GET /api/ia/contexto deve retornar contexto e prompt exportável', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/ia/contexto',
        cookies: { token: tokenAuth },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('contexto');
      expect(body).toHaveProperty('promptExportavel');
      expect(typeof body.promptExportavel).toBe('string');
    });

    it('POST /api/ia/parse deve interpretar texto em linguagem natural no modo CREDITOS', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/ia/parse',
        cookies: { token: tokenAuth },
        payload: {
          texto: 'Almoço no restaurante japonês R$ 89,90',
          modo: 'CREDITOS',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.modo).toBe('CREDITOS');
      expect(body.lancamento.valor).toBe(89.9);
      expect(body.lancamento.natureza).toBe('DESPESA');
      expect(body.creditosConsumidos).toBe(1);
    });

    it('POST /api/ia/parse deve aceitar e normalizar JSON colado externamente', async () => {
      const jsonColado = JSON.stringify({
        descricao: 'Compra de Teclado Mecânico',
        valor: 350.0,
        natureza: 'DESPESA',
        isPagamentoFatura: false,
        categoriaNomeSugerida: 'Habitação',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/ia/parse',
        cookies: { token: tokenAuth },
        payload: {
          texto: jsonColado,
          modo: 'EXTERNO',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.lancamento.descricao).toBe('Compra de Teclado Mecânico');
      expect(body.lancamento.valor).toBe(350.0);
    });

    it('GET /api/ia/status deve retornar o status de configuração de IA e os provedores suportados', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/ia/status',
        cookies: { token: tokenAuth },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('configurada');
      expect(body).toHaveProperty('hasEnvKey');
      expect(body).toHaveProperty('hasUserKey');
      expect(Array.isArray(body.provedoresSuportados)).toBe(true);
      expect(body.provedoresSuportados.map((p: any) => p.id)).toContain('GEMINI');
      expect(body.provedoresSuportados.map((p: any) => p.id)).toContain('OPENAI');
      expect(body.provedoresSuportados.map((p: any) => p.id)).toContain('ANTHROPIC');
    });

    it('POST /api/ia/testar-conexao deve responder erro se chave do Gemini for inválida', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/ia/testar-conexao',
        cookies: { token: tokenAuth },
        payload: {
          provedor: 'GEMINI',
          apiKey: 'AIzaSyChaveInvalidaParaTesteDeErro12345',
        },
      });

      // Se houver internet o Gemini rejeita com 400; se offline/sem conexão retorna 500
      expect([400, 500]).toContain(res.statusCode);
      const body = JSON.parse(res.body);
      expect(body.sucesso).toBe(false);
    }, 15000);
  });

  describe('Segurança Máxima: Criptografia AES-256-GCM e Chave no Banco de Dados', () => {
    it('CryptoService: deve criptografar e decifrar mantendo integridade com AES-256-GCM', async () => {
      const { CryptoService } = await import('../../infrastructure/security/crypto.service.js');
      const chaveOriginal = 'AIzaSyTestApiKeyUltraSecret1234567890';

      const cifrado = CryptoService.encrypt(chaveOriginal);
      expect(cifrado).toHaveProperty('ciphertext');
      expect(cifrado).toHaveProperty('iv');
      expect(cifrado).toHaveProperty('tag');
      expect(cifrado.ciphertext).not.toBe(chaveOriginal);

      // Decifrar
      const decifrado = CryptoService.decrypt(cifrado);
      expect(decifrado).toBe(chaveOriginal);

      // Mascarar
      const mascarada = CryptoService.mascararApiKey(chaveOriginal);
      expect(mascarada).toContain('...');
      expect(mascarada.startsWith('AIza')).toBe(true);
      expect(mascarada.endsWith('7890')).toBe(true);
    });

    it('CryptoService: deve falhar decifragem se auth tag for adulterada', async () => {
      const { CryptoService } = await import('../../infrastructure/security/crypto.service.js');
      const cifrado = CryptoService.encrypt('chave-secreta');

      // Modifica auth tag para simular adulteração maliciosa
      const tagAdulterada = '00' + cifrado.tag.substring(2);

      expect(() => {
        CryptoService.decrypt({
          ciphertext: cifrado.ciphertext,
          iv: cifrado.iv,
          tag: tagAdulterada,
        });
      }).toThrow();
    });

    it('PUT /api/ia/configuracao deve salvar a chave com criptografia AES-256-GCM atrelada ao usuario', async () => {
      const resPut = await app.inject({
        method: 'PUT',
        url: '/api/ia/configuracao',
        cookies: { token: tokenAuth },
        payload: {
          provedor: 'GEMINI',
          apiKey: 'AIzaSyChaveUltraSecretaDoUsuarioBanco12345',
          modelo: 'gemini-2.5-flash',
        },
      });

      expect(resPut.statusCode).toBe(200);
      const bodyPut = JSON.parse(resPut.body);
      expect(bodyPut.sucesso).toBe(true);
      expect(bodyPut.hasUserKey).toBe(true);
      expect(bodyPut.chaveMascarada).toBeDefined();
      expect(bodyPut.chaveMascarada).not.toContain('ChaveUltraSecretaDoUsuarioBanco');

      // GET /api/ia/status deve refletir que há chave do usuário
      const resStatus = await app.inject({
        method: 'GET',
        url: '/api/ia/status',
        cookies: { token: tokenAuth },
      });
      expect(resStatus.statusCode).toBe(200);
      const bodyStatus = JSON.parse(resStatus.body);
      expect(bodyStatus.hasUserKey).toBe(true);
      expect(bodyStatus.configurada).toBe(true);
      expect(bodyStatus.chaveMascarada).toBe(bodyPut.chaveMascarada);
    });

    it('deve permitir configurar múltiplos provedores para o mesmo usuário e refletir no status', async () => {
      // 1. Configura Gemini
      const resGemini = await app.inject({
        method: 'PUT',
        url: '/api/ia/configuracao',
        cookies: { token: tokenAuth },
        payload: {
          provedor: 'GEMINI',
          apiKey: 'AIzaSyChaveGeminiDoUsuario12345',
          modelo: 'gemini-2.5-flash',
        },
      });
      expect(resGemini.statusCode).toBe(200);

      // 2. Configura OpenAI para o mesmo usuário
      const resOpenAI = await app.inject({
        method: 'PUT',
        url: '/api/ia/configuracao',
        cookies: { token: tokenAuth },
        payload: {
          provedor: 'OPENAI',
          apiKey: 'sk-proj-ChaveOpenAiDoUsuario67890',
          modelo: 'gpt-4o-mini',
        },
      });
      expect(resOpenAI.statusCode).toBe(200);

      // 3. Status deve retornar 2 IAs ativas
      const resStatus = await app.inject({
        method: 'GET',
        url: '/api/ia/status',
        cookies: { token: tokenAuth },
      });
      expect(resStatus.statusCode).toBe(200);
      const bodyStatus = JSON.parse(resStatus.body);
      expect(bodyStatus.configurada).toBe(true);
      expect(bodyStatus.totalConfiguradas).toBe(2);
      expect(bodyStatus.configuracoes).toHaveLength(2);

      const provsConfigurados = bodyStatus.configuracoes.map((c: any) => c.provedor);
      expect(provsConfigurados).toContain('GEMINI');
      expect(provsConfigurados).toContain('OPENAI');

      // 4. Excluir especificamente a OpenAI via query param ?provedor=OPENAI
      const resDelOpenAi = await app.inject({
        method: 'DELETE',
        url: '/api/ia/configuracao?provedor=OPENAI',
        cookies: { token: tokenAuth },
      });
      expect(resDelOpenAi.statusCode).toBe(200);

      // 5. Status deve manter apenas Gemini
      const resStatusAposRemover = await app.inject({
        method: 'GET',
        url: '/api/ia/status',
        cookies: { token: tokenAuth },
      });
      const bodyApos = JSON.parse(resStatusAposRemover.body);
      expect(bodyApos.totalConfiguradas).toBe(1);
      expect(bodyApos.configuracoes).toHaveLength(1);
      expect(bodyApos.configuracoes[0].provedor).toBe('GEMINI');

      // 6. Limpar tudo
      await app.inject({
        method: 'DELETE',
        url: '/api/ia/configuracao',
        cookies: { token: tokenAuth },
      });
    });

    it('TASK-36: deve configurar, listar e validar provedor OPENROUTER no banco de dados', async () => {
      // 1. GET /api/ia/status deve listar OPENROUTER como provedor suportado
      const resStatusInicial = await app.inject({
        method: 'GET',
        url: '/api/ia/status',
        cookies: { token: tokenAuth },
      });
      expect(resStatusInicial.statusCode).toBe(200);
      const bodyInicial = JSON.parse(resStatusInicial.body);
      const openRouterSuportado = bodyInicial.provedoresSuportados.find((p: any) => p.id === 'OPENROUTER');
      expect(openRouterSuportado).toBeDefined();
      expect(openRouterSuportado.nome).toBe('OpenRouter');
      expect(openRouterSuportado.ajudaUrl).toBe('https://openrouter.ai/keys');

      // 2. PUT /api/ia/configuracao com OPENROUTER
      const resPut = await app.inject({
        method: 'PUT',
        url: '/api/ia/configuracao',
        cookies: { token: tokenAuth },
        payload: {
          provedor: 'OPENROUTER',
          apiKey: 'sk-or-v1-chaveSecretaOpenRouterTeste1234567890',
          modelo: 'deepseek/deepseek-chat',
        },
      });
      expect(resPut.statusCode).toBe(200);
      const bodyPut = JSON.parse(resPut.body);
      expect(bodyPut.sucesso).toBe(true);
      expect(bodyPut.provedor).toBe('OPENROUTER');

      // 3. GET /api/ia/status deve refletir OPENROUTER configurado e mascarado
      const resStatusApos = await app.inject({
        method: 'GET',
        url: '/api/ia/status',
        cookies: { token: tokenAuth },
      });
      const bodyStatusApos = JSON.parse(resStatusApos.body);
      const cfgOpenRouter = bodyStatusApos.configuracoes.find((c: any) => c.provedor === 'OPENROUTER');
      expect(cfgOpenRouter).toBeDefined();
      expect(cfgOpenRouter.modelo).toBe('deepseek/deepseek-chat');
      expect(cfgOpenRouter.chaveMascarada).toBeDefined();
      expect(cfgOpenRouter.chaveMascarada).not.toContain('chaveSecretaOpenRouterTeste');

      // 4. DELETE /api/ia/configuracao?provedor=OPENROUTER
      const resDel = await app.inject({
        method: 'DELETE',
        url: '/api/ia/configuracao?provedor=OPENROUTER',
        cookies: { token: tokenAuth },
      });
      expect(resDel.statusCode).toBe(200);
    });
  });
});

