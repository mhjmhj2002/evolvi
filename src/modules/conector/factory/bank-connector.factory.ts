import { IBankConnectorProvider } from '../types/bank-connector.interface.js';
import { GenericBankConnectorProvider } from '../providers/generic-bank-connector.provider.js';
import { ItauBankConnectorProvider } from '../providers/itau-bank-connector.provider.js';
import { SantanderBankConnectorProvider } from '../providers/santander-bank-connector.provider.js';
import { InterBankConnectorProvider } from '../providers/inter-bank-connector.provider.js';
import { NubankBankConnectorProvider } from '../providers/nubank-bank-connector.provider.js';

export interface CredentialFieldRequirement {
  id: string;
  label: string;
  placeholder?: string;
  tipo: 'text' | 'password' | 'select';
  obrigatorio: boolean;
  maxLength?: number;
  regexValidacao?: string;
  mensagemAjuda?: string;
}

export interface BankInstitutionMeta {
  codigo: string;
  nome: string;
  compe?: string;
  corPrimaria?: string;
  icone?: string;
  camposRequeridos: CredentialFieldRequirement[];
  orientacaoOpenFinance: string;
}

/**
 * Fábrica e catálogo unificado de conectores bancários e Open Finance Brasil.
 */
export class BankConnectorFactory {
  private static providers: Map<string, IBankConnectorProvider> = new Map();

  private static instituicoesHomologadas: BankInstitutionMeta[] = [
    {
      codigo: 'CON-HUB',
      nome: 'Hub Open Finance Brasil (Genérico)',
      corPrimaria: '#0284c7',
      camposRequeridos: [
        {
          id: 'clientId',
          label: 'Client ID / Identificador de Aplicação Open Finance',
          placeholder: 'Ex: of-client-98218-prod',
          tipo: 'text',
          obrigatorio: true,
          mensagemAjuda: 'Identificador único emitido pelo diretório central do Open Finance Brasil.',
        },
        {
          id: 'certificadoThumbprint',
          label: 'Thumbprint / Chave mTLS',
          placeholder: 'Ex: a7b8c9d0e1f2...',
          tipo: 'text',
          obrigatorio: true,
          mensagemAjuda: 'Chave de identificação do certificado ICP-Brasil regulado.',
        },
      ],
      orientacaoOpenFinance:
        'Conexão genérica direta com o ecossistema Open Finance regulado pelo Banco Central do Brasil. Requer credenciais de API mTLS.',
    },
    {
      codigo: '341',
      nome: 'Itaú Unibanco',
      compe: '341',
      corPrimaria: '#ec7000',
      camposRequeridos: [
        {
          id: 'agencia',
          label: 'Agência Itaú (4 dígitos)',
          placeholder: 'Ex: 0910',
          tipo: 'text',
          obrigatorio: true,
          maxLength: 4,
          regexValidacao: '^\\d{4}$',
          mensagemAjuda: 'Agência da conta corrente Itaú (exatamente 4 números sem dígito).',
        },
        {
          id: 'conta',
          label: 'Conta Corrente com Dígito',
          placeholder: 'Ex: 54321-0',
          tipo: 'text',
          obrigatorio: true,
          mensagemAjuda: 'Número da conta corrente Itaú com dígito verificador.',
        },
      ],
      orientacaoOpenFinance:
        'Conexão com contas correntes Itaú e cartões Itaucard. Transações de fatura de cartão convertidas em transferência própria anti-dupla contagem.',
    },
    {
      codigo: '033',
      nome: 'Santander',
      compe: '033',
      corPrimaria: '#cc0000',
      camposRequeridos: [
        {
          id: 'agencia',
          label: 'Agência Santander (4 dígitos)',
          placeholder: 'Ex: 2041',
          tipo: 'text',
          obrigatorio: true,
          maxLength: 4,
          regexValidacao: '^\\d{4}$',
          mensagemAjuda: 'Agência da conta Santander (4 dígitos sem hífen).',
        },
        {
          id: 'conta',
          label: 'Conta Corrente com Dígito',
          placeholder: 'Ex: 88765-4',
          tipo: 'text',
          obrigatorio: true,
          mensagemAjuda: 'Conta corrente Santander com dígito.',
        },
      ],
      orientacaoOpenFinance:
        'Conexão com contas correntes Santander e cartões Santander SX / Way. Suporte a conciliação automática e leitura de extratos.',
    },
    {
      codigo: '077',
      nome: 'Banco Inter',
      compe: '077',
      corPrimaria: '#ff7a00',
      camposRequeridos: [
        {
          id: 'contaCorrente',
          label: 'Conta Digital Inter com Dígito',
          placeholder: 'Ex: 1234567-8',
          tipo: 'text',
          obrigatorio: true,
          mensagemAjuda: 'Número da sua conta digital Banco Inter.',
        },
        {
          id: 'chavePix',
          label: 'Chave PIX / CPF do Titular',
          placeholder: 'Ex: 123.456.789-00',
          tipo: 'text',
          obrigatorio: true,
          mensagemAjuda: 'Chave PIX ou CPF associado à conta digital do Inter para validação de titularidade.',
        },
      ],
      orientacaoOpenFinance:
        'Conexão via API correntista Banco Inter e Open Finance com suporte a cashback, compras no Inter Shop e cartões Mastercard.',
    },
    {
      codigo: '260',
      nome: 'Nubank',
      compe: '260',
      corPrimaria: '#820ad1',
      camposRequeridos: [
        {
          id: 'cpf',
          label: 'CPF do Titular',
          placeholder: 'Ex: 123.456.789-00',
          tipo: 'text',
          obrigatorio: true,
          mensagemAjuda: 'CPF cadastrado na NuConta.',
        },
        {
          id: 'senhaApp',
          label: 'Senha de Acesso do App Nubank (8 dígitos) ou Token',
          placeholder: '••••••••',
          tipo: 'password',
          obrigatorio: true,
          mensagemAjuda: 'Credencial para autorização de consentimento Open Finance.',
        },
      ],
      orientacaoOpenFinance:
        'Compartilhamento regulado de extratos da NuConta e faturas do cartão de crédito Nubank.',
    },
    {
      codigo: '735',
      nome: 'Banco Neon',
      compe: '735',
      corPrimaria: '#00e5ff',
      camposRequeridos: [
        {
          id: 'conta',
          label: 'Conta Digital Neon',
          placeholder: 'Ex: 12345-6',
          tipo: 'text',
          obrigatorio: true,
          mensagemAjuda: 'Número da conta Neon com dígito.',
        },
        {
          id: 'cpf',
          label: 'CPF do Titular',
          placeholder: 'Ex: 123.456.789-00',
          tipo: 'text',
          obrigatorio: true,
        },
      ],
      orientacaoOpenFinance: 'Conexão para extratos de conta digital e cartões Neon.',
    },
    {
      codigo: '290',
      nome: 'PagBank (PagSeguro)',
      compe: '290',
      corPrimaria: '#00a868',
      camposRequeridos: [
        {
          id: 'tokenApi',
          label: 'Token de Conexão / Autorização PagBank',
          placeholder: 'Ex: pagbank-token-live-...',
          tipo: 'password',
          obrigatorio: true,
          mensagemAjuda: 'Token obtido no painel do desenvolvedor ou consentimento Open Finance.',
        },
      ],
      orientacaoOpenFinance: 'Sincronização de vendas, recebíveis e movimentações PagBank.',
    },
    {
      codigo: '001',
      nome: 'Banco do Brasil',
      compe: '001',
      corPrimaria: '#fbf800',
      camposRequeridos: [
        {
          id: 'agencia',
          label: 'Agência BB (4 dígitos com dígito se houver)',
          placeholder: 'Ex: 1234-5',
          tipo: 'text',
          obrigatorio: true,
        },
        {
          id: 'conta',
          label: 'Conta Corrente BB com Dígito',
          placeholder: 'Ex: 98765-4',
          tipo: 'text',
          obrigatorio: true,
        },
      ],
      orientacaoOpenFinance: 'Conexão Open Finance Banco do Brasil com suporte a Ourocard e conta corrente.',
    },
    {
      codigo: '104',
      nome: 'Caixa Econômica Federal',
      compe: '104',
      corPrimaria: '#005ca9',
      camposRequeridos: [
        {
          id: 'agencia',
          label: 'Agência Caixa (4 dígitos)',
          placeholder: 'Ex: 0123',
          tipo: 'text',
          obrigatorio: true,
          maxLength: 4,
        },
        {
          id: 'operacao',
          label: 'Operação (Ex: 001, 1288)',
          placeholder: 'Ex: 001',
          tipo: 'text',
          obrigatorio: true,
        },
        {
          id: 'conta',
          label: 'Número da Conta com Dígito',
          placeholder: 'Ex: 12345678-9',
          tipo: 'text',
          obrigatorio: true,
        },
      ],
      orientacaoOpenFinance: 'Conexão com contas da Caixa e cartões Caixa Elo/Visa/Mastercard.',
    },
    {
      codigo: '237',
      nome: 'Banco Bradesco',
      compe: '237',
      corPrimaria: '#cc092f',
      camposRequeridos: [
        {
          id: 'agencia',
          label: 'Agência Bradesco (4 dígitos)',
          placeholder: 'Ex: 0543',
          tipo: 'text',
          obrigatorio: true,
          maxLength: 4,
        },
        {
          id: 'conta',
          label: 'Conta Corrente com Dígito',
          placeholder: 'Ex: 123456-7',
          tipo: 'text',
          obrigatorio: true,
        },
      ],
      orientacaoOpenFinance: 'Conexão com contas Bradesco e cartões Bradescard.',
    },
    {
      codigo: '021',
      nome: 'Banestes',
      compe: '021',
      corPrimaria: '#004b93',
      camposRequeridos: [
        {
          id: 'agencia',
          label: 'Agência Banestes (3 ou 4 dígitos)',
          placeholder: 'Ex: 123',
          tipo: 'text',
          obrigatorio: true,
        },
        {
          id: 'conta',
          label: 'Conta Corrente Banestes com Dígito',
          placeholder: 'Ex: 1234567-8',
          tipo: 'text',
          obrigatorio: true,
        },
      ],
      orientacaoOpenFinance: 'Conexão com Banco do Estado do Espírito Santo (Banestes).',
    },
    {
      codigo: '336',
      nome: 'C6 Bank',
      compe: '336',
      corPrimaria: '#242424',
      camposRequeridos: [
        {
          id: 'conta',
          label: 'Conta Digital C6 Bank',
          placeholder: 'Ex: 123456-7',
          tipo: 'text',
          obrigatorio: true,
        },
        {
          id: 'cpf',
          label: 'CPF do Titular',
          placeholder: 'Ex: 123.456.789-00',
          tipo: 'text',
          obrigatorio: true,
        },
      ],
      orientacaoOpenFinance: 'Conexão de contas e cartões C6 Carbon / Black.',
    },
    {
      codigo: '208',
      nome: 'BTG Pactual',
      compe: '208',
      corPrimaria: '#14213d',
      camposRequeridos: [
        {
          id: 'conta',
          label: 'Conta Corrente BTG Banking',
          placeholder: 'Ex: 1234567-8',
          tipo: 'text',
          obrigatorio: true,
        },
        {
          id: 'cpf',
          label: 'CPF do Titular',
          placeholder: 'Ex: 123.456.789-00',
          tipo: 'text',
          obrigatorio: true,
        },
      ],
      orientacaoOpenFinance: 'Conexão BTG Banking e Investimentos.',
    },
    {
      codigo: '756',
      nome: 'Sicoob',
      compe: '756',
      corPrimaria: '#003641',
      camposRequeridos: [
        {
          id: 'cooperativa',
          label: 'Número da Cooperativa (4 dígitos)',
          placeholder: 'Ex: 4321',
          tipo: 'text',
          obrigatorio: true,
          maxLength: 4,
        },
        {
          id: 'conta',
          label: 'Conta Corrente com Dígito',
          placeholder: 'Ex: 12345-6',
          tipo: 'text',
          obrigatorio: true,
        },
      ],
      orientacaoOpenFinance: 'Conexão cooperativa de crédito Sicoob.',
    },
    {
      codigo: '748',
      nome: 'Sicredi',
      compe: '748',
      corPrimaria: '#007038',
      camposRequeridos: [
        {
          id: 'cooperativa',
          label: 'Agência / Cooperativa Sicredi (4 dígitos)',
          placeholder: 'Ex: 0123',
          tipo: 'text',
          obrigatorio: true,
          maxLength: 4,
        },
        {
          id: 'conta',
          label: 'Conta Corrente com Dígito',
          placeholder: 'Ex: 12345-6',
          tipo: 'text',
          obrigatorio: true,
        },
      ],
      orientacaoOpenFinance: 'Conexão cooperativa de crédito Sicredi.',
    },
  ];

  static {
    // Registrar o conector genérico / hub
    this.registerProvider(new GenericBankConnectorProvider('CON-HUB', 'Hub Open Finance Brasil'));

    // Registrar o conector especializado Itaú Unibanco (COMPE 341 e alias CON-ITAU)
    const itauProvider = new ItauBankConnectorProvider();
    this.registerProvider(itauProvider);
    this.providers.set('CON-ITAU', itauProvider);

    // Registrar o conector especializado Santander Brasil (COMPE 033 e alias CON-SANTANDER)
    const santanderProvider = new SantanderBankConnectorProvider();
    this.registerProvider(santanderProvider);
    this.providers.set('CON-SANTANDER', santanderProvider);

    // Registrar o conector especializado Banco Inter (COMPE 077 e alias CON-INTER)
    const interProvider = new InterBankConnectorProvider();
    this.registerProvider(interProvider);
    this.providers.set('CON-INTER', interProvider);

    // Registrar o conector especializado Nubank (COMPE 260 e alias CON-NUBANK)
    const nubankProvider = new NubankBankConnectorProvider();
    this.registerProvider(nubankProvider);
    this.providers.set('CON-NUBANK', nubankProvider);
  }

  /**
   * Registra dinamicamente uma implementação de conector bancário
   */
  public static registerProvider(provider: IBankConnectorProvider): void {
    this.providers.set(provider.codigo, provider);
    if (provider.compe) {
      this.providers.set(provider.compe, provider);
    }
  }

  /**
   * Retorna o provedor registrado para a instituição ou instância genérica se homologada
   */
  public static getProvider(codigoOuCompe: string): IBankConnectorProvider {
    const provider = this.providers.get(codigoOuCompe);
    if (provider) {
      return provider;
    }

    // Se estiver no catálogo de instituições homologadas mas sem conector especializado registrado ainda,
    // instancia um provedor compatível baseado no Hub Open Finance
    const meta = this.instituicoesHomologadas.find(
      (inst) => inst.codigo === codigoOuCompe || inst.compe === codigoOuCompe
    );

    if (meta) {
      const fallbackProvider = new GenericBankConnectorProvider(
        meta.codigo,
        meta.nome,
        meta.compe
      );
      this.registerProvider(fallbackProvider);
      return fallbackProvider;
    }

    throw new Error(`Nenhum conector bancário encontrado para a instituição [${codigoOuCompe}].`);
  }

  /**
   * Retorna metadados e requisitos de credenciais da instituição
   */
  public static getInstitutionMeta(codigoOuCompe: string): BankInstitutionMeta | undefined {
    return this.instituicoesHomologadas.find(
      (inst) => inst.codigo === codigoOuCompe || inst.compe === codigoOuCompe
    );
  }

  /**
   * Lista todas as instituições suportadas no catálogo
   */
  public static listSupportedInstitutions(): BankInstitutionMeta[] {
    return [...this.instituicoesHomologadas];
  }
}

