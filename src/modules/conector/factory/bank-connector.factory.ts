import { IBankConnectorProvider } from '../types/bank-connector.interface.js';
import { GenericBankConnectorProvider } from '../providers/generic-bank-connector.provider.js';
import { ItauBankConnectorProvider } from '../providers/itau-bank-connector.provider.js';
import { SantanderBankConnectorProvider } from '../providers/santander-bank-connector.provider.js';
import { InterBankConnectorProvider } from '../providers/inter-bank-connector.provider.js';

export interface BankInstitutionMeta {
  codigo: string;
  nome: string;
  compe?: string;
  corPrimaria?: string;
  icone?: string;
}

/**
 * Fábrica e catálogo unificado de conectores bancários e Open Finance Brasil.
 */
export class BankConnectorFactory {
  private static providers: Map<string, IBankConnectorProvider> = new Map();

  private static instituicoesHomologadas: BankInstitutionMeta[] = [
    { codigo: 'CON-HUB', nome: 'Hub Open Finance Brasil (Genérico)', corPrimaria: '#0284c7' },
    { codigo: '341', nome: 'Itaú Unibanco', compe: '341', corPrimaria: '#ec7000' },
    { codigo: '033', nome: 'Santander', compe: '033', corPrimaria: '#cc0000' },
    { codigo: '077', nome: 'Banco Inter', compe: '077', corPrimaria: '#ff7a00' },
    { codigo: '260', nome: 'Nubank', compe: '260', corPrimaria: '#820ad1' },
    { codigo: '735', nome: 'Banco Neon', compe: '735', corPrimaria: '#00e5ff' },
    { codigo: '290', nome: 'PagBank (PagSeguro)', compe: '290', corPrimaria: '#00a868' },
    { codigo: '001', nome: 'Banco do Brasil', compe: '001', corPrimaria: '#fbf800' },
    { codigo: '104', nome: 'Caixa Econômica Federal', compe: '104', corPrimaria: '#005ca9' },
    { codigo: '237', nome: 'Banco Bradesco', compe: '237', corPrimaria: '#cc092f' },
    { codigo: '021', nome: 'Banestes', compe: '021', corPrimaria: '#004b93' },
    { codigo: '336', nome: 'C6 Bank', compe: '336', corPrimaria: '#242424' },
    { codigo: '208', nome: 'BTG Pactual', compe: '208', corPrimaria: '#14213d' },
    { codigo: '756', nome: 'Sicoob', compe: '756', corPrimaria: '#003641' },
    { codigo: '748', nome: 'Sicredi', compe: '748', corPrimaria: '#007038' },
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
   * Lista todas as instituições suportadas no catálogo
   */
  public static listSupportedInstitutions(): BankInstitutionMeta[] {
    return [...this.instituicoesHomologadas];
  }
}
