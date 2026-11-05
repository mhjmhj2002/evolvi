import { describe, it, expect } from 'vitest';
import {
  calcularDigitoVerificadorModulo11,
  validarChaveAcessoNfe,
  decomporChaveAcesso,
  extrairPayloadQrCodeNfe,
  limparChaveAcesso,
  parseHtmlSefazNfce,
} from './nota-fiscal.util.js';

describe('TASK-54: Utilitários e Validação de Nota Fiscal (NFC-e / NF-e)', () => {
  // Chave de exemplo de 44 dígitos com DV válido
  // UF=35 (SP), AAMM=2603, CNPJ=12345678000195, Mod=65, Serie=001, Num=000123456, TpEmis=1, Cod=12345678
  const chave43 = '3526031234567800019565001000123456112345678';
  const dvCalculado = calcularDigitoVerificadorModulo11(chave43);
  const chaveCompletaValida = `${chave43}${dvCalculado}`;

  it('deve calcular corretamente o Dígito Verificador Módulo 11', () => {
    expect(dvCalculado).toBeDefined();
    expect(dvCalculado).toMatch(/^[0-9]$/);

    // Teste com uma chave conhecida da SEFAZ SP:
    // 35 1508 61940292000388 55 001 000000002 1 00000002 6
    const chaveConhecida43 = '3515086194029200038855001000000002100000002';
    expect(calcularDigitoVerificadorModulo11(chaveConhecida43)).toBe('6');
  });

  it('deve validar com sucesso uma chave de 44 dígitos com DV correto', () => {
    expect(validarChaveAcessoNfe(chaveCompletaValida)).toBe(true);
  });

  it('deve rejeitar chaves com DV incorreto, tamanho diferente ou UF inválida', () => {
    // DV incorreto
    const dvIncorreto = dvCalculado === '9' ? '0' : (parseInt(dvCalculado, 10) + 1).toString();
    expect(validarChaveAcessoNfe(`${chave43}${dvIncorreto}`)).toBe(false);

    // Menos de 44 dígitos
    expect(validarChaveAcessoNfe(chave43)).toBe(false);

    // UF inválida (ex: 99)
    const chaveUfInvalida = `99${chave43.substring(2)}${dvCalculado}`;
    expect(validarChaveAcessoNfe(chaveUfInvalida)).toBe(false);

    // String vazia ou lixo
    expect(validarChaveAcessoNfe('')).toBe(false);
    expect(validarChaveAcessoNfe('abc')).toBe(false);
  });

  it('deve decompor os campos da chave de acesso com precisão', () => {
    const decomposta = decomporChaveAcesso(chaveCompletaValida);
    expect(decomposta).not.toBeNull();
    expect(decomposta?.ufCodigo).toBe('35');
    expect(decomposta?.ufSigla).toBe('SP');
    expect(decomposta?.anoMes).toBe('2603');
    expect(decomposta?.ano).toBe(2026);
    expect(decomposta?.mes).toBe(3);
    expect(decomposta?.cnpj).toBe('12345678000195');
    expect(decomposta?.modelo).toBe('65'); // NFC-e
    expect(decomposta?.serie).toBe('001');
    expect(decomposta?.numero).toBe('000123456');
    expect(decomposta?.tipoEmissao).toBe('1');
    expect(decomposta?.codigoNumerico).toBe('12345678');
    expect(decomposta?.digitoVerificador).toBe(dvCalculado);
    expect(decomposta?.valida).toBe(true);
  });

  it('deve extrair payload a partir de digitação direta ou formatada com espaços', () => {
    const chaveFormatada = chaveCompletaValida.replace(/(.{4})/g, '$1 ').trim();
    const payload = extrairPayloadQrCodeNfe(chaveFormatada);
    expect(payload).not.toBeNull();
    expect(payload?.chaveAcesso).toBe(chaveCompletaValida);
  });

  it('deve extrair payload de URL de QR Code padrão SEFAZ com parâmetro p=', () => {
    const urlQrCode = `https://www.nfce.fazenda.sp.gov.br/qrcode?p=${chaveCompletaValida}|2|1|15|214.80|A1B2C3D4|1`;
    const payload = extrairPayloadQrCodeNfe(urlQrCode);

    expect(payload).not.toBeNull();
    expect(payload?.chaveAcesso).toBe(chaveCompletaValida);
    expect(payload?.versao).toBe('2');
    expect(payload?.ambiente).toBe('PRODUCAO');
    expect(payload?.diaEmissao).toBe(15);
    expect(payload?.valorTotal).toBe(214.8);
    expect(payload?.digestValue).toBe('A1B2C3D4');
  });

  it('deve extrair payload de URL com parâmetros chNFe e vNF', () => {
    const urlParametrizada = `https://portal.sefaz.es.gov.br/consulta?chNFe=${chaveCompletaValida}&vNF=98.50`;
    const payload = extrairPayloadQrCodeNfe(urlParametrizada);

    expect(payload).not.toBeNull();
    expect(payload?.chaveAcesso).toBe(chaveCompletaValida);
    expect(payload?.valorTotal).toBe(98.5);
  });

  it('deve extrair dados de HTML de consulta da SEFAZ', () => {
    const mockHtml = `
      <html>
        <body>
          <div class="txtTopo">SUPERMERCADO CENTRAL LTDA</div>
          <div class="totalNFe">
            <span class="vlr">187,45</span>
          </div>
          <div class="campo">
            <span>Emissão: 28/10/2026 14:32:10</span>
          </div>
        </body>
      </html>
    `;

    const extraidos = parseHtmlSefazNfce(mockHtml);
    expect(extraidos.valorTotal).toBe(187.45);
    expect(extraidos.razaoSocial).toBe('SUPERMERCADO CENTRAL LTDA');
    expect(extraidos.dataEmissao).toBe('2026-10-28');
  });
});

