import crypto from 'node:crypto';
import { env } from '../../config/env.js';

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  tag: string;
}

/**
 * Serviço de criptografia de dados confidenciais em repouso (at-rest)
 * utilizando o padrão bancário/militar AES-256-GCM (Authenticated Encryption).
 */
export class CryptoService {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_LENGTH = 12; // 96 bits recomendado pelo NIST para AES-GCM
  private static readonly TAG_LENGTH = 16; // 128 bits auth tag

  /**
   * Obtém ou deriva a chave mestra de 256 bits (32 bytes).
   */
  private static getMasterKey(): Buffer {
    const rawKey = env.ENCRYPTION_KEY || env.JWT_SECRET;
    // Derivação com SHA-256 garante exatamente 32 bytes mesmo se a string for maior ou menor
    return crypto.createHash('sha256').update(rawKey, 'utf8').digest();
  }

  /**
   * Criptografa uma string em texto plano usando AES-256-GCM com IV aleatório por operação.
   * Retorna os componentes codificados em hexadecimal.
   */
  public static encrypt(plainText: string): EncryptedData {
    if (!plainText) {
      throw new Error('Texto para criptografia não pode ser vazio.');
    }

    const key = this.getMasterKey();
    const iv = crypto.randomBytes(this.IV_LENGTH);
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    return {
      ciphertext: encrypted.toString('hex'),
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
    };
  }

  /**
   * Decifra um dado previamente criptografado com AES-256-GCM.
   * Valida a integridade da Auth Tag para impedir adulteração de dados.
   */
  public static decrypt(data: EncryptedData): string {
    if (!data.ciphertext || !data.iv || !data.tag) {
      throw new Error('Dados incompletos para decifragem AES-256-GCM.');
    }

    const key = this.getMasterKey();
    const iv = Buffer.from(data.iv, 'hex');
    const tag = Buffer.from(data.tag, 'hex');
    const ciphertext = Buffer.from(data.ciphertext, 'hex');

    const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  /**
   * Mascara uma chave de API para exibição segura na interface (ex: "AIza...4x9B")
   */
  public static mascararApiKey(apiKey: string): string {
    if (!apiKey) return '';
    const trimmed = apiKey.trim();
    if (trimmed.length <= 8) return '****';
    const inicio = trimmed.substring(0, 4);
    const fim = trimmed.substring(trimmed.length - 4);
    return `${inicio}...${fim}`;
  }
}
