import React, { useState, useEffect, useRef } from 'react';
import {
  QrCode,
  Keyboard,
  Camera,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
  X,
  Store,
  Calendar,
  CreditCard,
  Tag,
} from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { apiService, MovimentoItem } from '../api.js';
import { formatarDataIso } from '../utils/data.ts';

export interface NotaFiscalParsedDados {
  chaveAcesso: string;
  valorTotal?: number | null;
  dataEmissao?: string;
  competencia?: string;
  descricaoSugerida?: string;
  categoriaSugeridaId?: string | null;
  categoriaSugeridaNome?: string | null;
  cnpj?: string;
  uf?: string;
  modelo?: string;
}

interface LeitorNotaFiscalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNotaCapturada: (dados: NotaFiscalParsedDados) => void;
  onAbrirMovimentoExistente?: (movimento: MovimentoItem) => void;
}

// Mapeamento de Código IBGE da UF para Sigla
const CODIGO_IBGE: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL',
  '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

function calcularModulo11(chave43: string): string {
  let soma = 0;
  let peso = 2;
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += parseInt(chave43[i], 10) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = 11 - resto;
  if (dv === 0 || dv === 1 || dv >= 10) return '0';
  return dv.toString();
}

function validarChaveFrontend(chaveRaw: string): boolean {
  const limpa = chaveRaw.replace(/\D/g, '');
  if (limpa.length !== 44) return false;
  const uf = limpa.substring(0, 2);
  if (!CODIGO_IBGE[uf]) return false;
  const chave43 = limpa.substring(0, 43);
  const dvInformado = limpa.substring(43, 44);
  return dvInformado === calcularModulo11(chave43);
}

function formatarChaveEmBlocos(chaveRaw: string): string {
  const limpa = chaveRaw.replace(/\D/g, '').substring(0, 44);
  return limpa.replace(/(\d{4})/g, '$1 ').trim();
}

export const LeitorNotaFiscalModal: React.FC<LeitorNotaFiscalModalProps> = ({
  isOpen,
  onClose,
  onNotaCapturada,
  onAbrirMovimentoExistente,
}) => {
  const [abaAtiva, setAbaAtiva] = useState<'SCANNER' | 'DIGITACAO'>('SCANNER');
  const [chaveDigitada, setChaveDigitada] = useState<string>('');
  const [chaveValida, setChaveValida] = useState<boolean>(false);

  // Estados de consulta / validação
  const [consultando, setConsultando] = useState<boolean>(false);
  const [erroConsulta, setErroConsulta] = useState<string | null>(null);
  const [movimentoDuplicado, setMovimentoDuplicado] = useState<MovimentoItem | null>(null);

  // Scanner de Câmera
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [scannerIniciado, setScannerIniciado] = useState<boolean>(false);
  const [erroCamera, setErroCamera] = useState<string | null>(null);
  const [, setUltimoPayloadLido] = useState<string | null>(null);

  // Som / Bip de leitura
  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime); // Tom lá agudo
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
      if (navigator.vibrate) {
        navigator.vibrate(100);
      }
    } catch {
      // AudioContext não suportado ou bloqueado
    }
  };

  // Inicializa e limpa o leitor de QR Code quando a aba for SCANNER e modal estiver aberto.
  // html5-qrcode lança "Cannot transition to a new state, already under transition" (de forma
  // síncrona) se start/stop forem chamados em sobreposição; por isso todas as operações são
  // serializadas numa única fila de promises e cada stop é protegido por try/catch.
  const filaScannerRef = useRef<Promise<void>>(Promise.resolve());
  const leituraEmAndamentoRef = useRef<string | null>(null);

  useEffect(() => {
    let ativo = true;

    const enfileirar = (tarefa: () => Promise<void>) => {
      filaScannerRef.current = filaScannerRef.current.then(tarefa).catch(() => {});
      return filaScannerRef.current;
    };

    const pararScanner = async () => {
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (!scanner) return;
      try {
        const estado = scanner.getState();
        // 2 = SCANNING, 3 = PAUSED
        if (estado === 2 || estado === 3) {
          await scanner.stop();
        }
      } catch {
        // Já estava parado ou em transição
      }
      try {
        scanner.clear();
      } catch {
        // Elemento já removido
      }
    };

    if (isOpen && abaAtiva === 'SCANNER' && !movimentoDuplicado) {
      setErroCamera(null);
      const timer = setTimeout(() => {
        enfileirar(async () => {
          const element = document.getElementById('reader-qr-viewfinder');
          if (!element || !ativo) return;

          await pararScanner();

          try {
            const html5QrCode = new Html5Qrcode('reader-qr-viewfinder', {
              formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
              verbose: false,
            });
            scannerRef.current = html5QrCode;

            await html5QrCode.start(
              { facingMode: 'environment' },
              {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1.0,
              },
              (decodedText) => {
                if (decodedText && decodedText !== leituraEmAndamentoRef.current) {
                  leituraEmAndamentoRef.current = decodedText;
                  setUltimoPayloadLido(decodedText);
                  playBeep();
                  processarInputNota(decodedText);
                }
              },
              () => {
                // Frame sem QR Code detectado
              }
            );

            if (ativo) {
              setScannerIniciado(true);
            } else {
              await pararScanner();
            }
          } catch (err: any) {
            scannerRef.current = null;
            if (ativo) {
              console.warn('Erro ao acessar câmera para leitura de QR Code:', err);
              setErroCamera(
                'Não foi possível inicializar a câmera. Verifique as permissões do navegador ou utilize a digitação manual da chave de 44 dígitos.'
              );
            }
          }
        });
      }, 300);

      return () => {
        ativo = false;
        clearTimeout(timer);
        leituraEmAndamentoRef.current = null;
        enfileirar(async () => {
          await pararScanner();
          setScannerIniciado(false);
        });
      };
    }

    enfileirar(async () => {
      await pararScanner();
      setScannerIniciado(false);
    });
    return undefined;
  }, [isOpen, abaAtiva, movimentoDuplicado]);

  // Validação da chave digitada
  useEffect(() => {
    const limpa = chaveDigitada.replace(/\D/g, '');
    const valida = validarChaveFrontend(limpa);
    setChaveValida(valida);
  }, [chaveDigitada]);

  const processarInputNota = async (inputStr: string) => {
    setConsultando(true);
    setErroConsulta(null);
    setMovimentoDuplicado(null);

    // Para o scanner enquanto processa
    if (scannerRef.current && scannerIniciado) {
      try {
        await scannerRef.current.stop();
        setScannerIniciado(false);
      } catch {
        // Ignora
      }
    }

    try {
      const res = await apiService.consultarNotaFiscal(inputStr);

      if (res.duplicada && res.movimentoExistente) {
        setMovimentoDuplicado(res.movimentoExistente);
        return;
      }

      if (res.dadosNota) {
        onNotaCapturada({
          chaveAcesso: res.dadosNota.chaveAcesso,
          valorTotal: res.dadosNota.valorTotal,
          dataEmissao: res.dadosNota.dataEmissao,
          competencia: res.dadosNota.competencia,
          descricaoSugerida: res.dadosNota.descricaoSugerida,
          categoriaSugeridaId: res.dadosNota.categoriaSugeridaId,
          categoriaSugeridaNome: res.dadosNota.categoriaSugeridaNome,
          cnpj: res.dadosNota.cnpj,
          uf: res.dadosNota.uf,
          modelo: res.dadosNota.modelo,
        });
        onClose();
      }
    } catch (err: any) {
      setErroConsulta(err.message || 'Falha ao processar dados da nota fiscal.');
    } finally {
      setConsultando(false);
    }
  };

  const handleDigitarChaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const limpa = chaveDigitada.replace(/\D/g, '');
    if (!validarChaveFrontend(limpa)) {
      setErroConsulta('A chave de acesso digitada é inválida. Certifique-se de digitar todos os 44 dígitos com DV correto.');
      return;
    }
    processarInputNota(limpa);
  };

  const handleColarClipboard = async () => {
    try {
      const texto = await navigator.clipboard.readText();
      if (texto) {
        const formatada = formatarChaveEmBlocos(texto);
        setChaveDigitada(formatada);
        if (validarChaveFrontend(texto)) {
          processarInputNota(texto);
        }
      }
    } catch {
      // Permissão negada para clipboard
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(5px)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '520px',
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-color)',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '92vh',
        }}
      >
        {/* Cabeçalho */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-card)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                backgroundColor: 'rgba(56, 189, 248, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--brand-primary)',
              }}
            >
              <QrCode size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Ler Nota Fiscal (NFC-e / SAT)
              </h2>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Lançamento ágil com bloqueio de duplicidade
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px',
              display: 'flex',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Abas: Scanner vs Digitação */}
        {!movimentoDuplicado && (
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-card)',
            }}
          >
            <button
              type="button"
              onClick={() => {
                setAbaAtiva('SCANNER');
                setErroConsulta(null);
              }}
              style={{
                flex: 1,
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                border: 'none',
                background: abaAtiva === 'SCANNER' ? 'var(--bg-secondary)' : 'transparent',
                color: abaAtiva === 'SCANNER' ? 'var(--brand-primary)' : 'var(--text-secondary)',
                fontWeight: abaAtiva === 'SCANNER' ? 700 : 500,
                fontSize: '0.85rem',
                borderBottom: abaAtiva === 'SCANNER' ? '2px solid var(--brand-primary)' : '2px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <Camera size={16} />
              Escanear QR Code
            </button>
            <button
              type="button"
              onClick={() => {
                setAbaAtiva('DIGITACAO');
                setErroConsulta(null);
              }}
              style={{
                flex: 1,
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                border: 'none',
                background: abaAtiva === 'DIGITACAO' ? 'var(--bg-secondary)' : 'transparent',
                color: abaAtiva === 'DIGITACAO' ? 'var(--brand-primary)' : 'var(--text-secondary)',
                fontWeight: abaAtiva === 'DIGITACAO' ? 700 : 500,
                fontSize: '0.85rem',
                borderBottom: abaAtiva === 'DIGITACAO' ? '2px solid var(--brand-primary)' : '2px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <Keyboard size={16} />
              Digitar Chave (44 Dígitos)
            </button>
          </div>
        )}

        {/* Conteúdo Principal */}
        <div style={{ padding: '20px', overflowY: 'auto' }}>
          {/* Alerta de Duplicata Bloqueada (TASK-54 Requisito 4.1) */}
          {movimentoDuplicado ? (
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid var(--status-red)',
                borderRadius: 'var(--radius-md)',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--status-red)' }}>
                <AlertTriangle size={24} />
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
                  Esta nota fiscal já foi lançada anteriormente!
                </h3>
              </div>

              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                O sistema identificou que este cupom fiscal já se encontra registrado no seu extrato. Por segurança e para evitar dupla contagem, um novo lançamento está bloqueado.
              </p>

              {/* Card de Localização e Detalhes do Lançamento Existente */}
              <div
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    <Store size={16} color="var(--brand-primary)" />
                    {movimentoDuplicado.descricao}
                  </div>
                  <span
                    style={{
                      fontSize: '1rem',
                      fontWeight: 800,
                      color: 'var(--status-red)',
                    }}
                  >
                    R$ {movimentoDuplicado.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Calendar size={14} />
                    <span>Data: <strong>{formatarDataIso(movimentoDuplicado.dataMovimento)}</strong></span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <CreditCard size={14} />
                    <span>Conta: <strong>{movimentoDuplicado.conta?.nome || 'Principal'}</strong></span>
                  </div>
                  {movimentoDuplicado.categoria && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', gridColumn: 'span 2' }}>
                      <Tag size={14} />
                      <span>Categoria: <strong>{movimentoDuplicado.categoria.nome}</strong></span>
                    </div>
                  )}
                </div>

                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  Chave: {movimentoDuplicado.chaveAcessoNfe}
                </div>
              </div>

              {/* Botões de Ação para o Usuário */}
              <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                {onAbrirMovimentoExistente && (
                  <button
                    type="button"
                    onClick={() => {
                      onAbrirMovimentoExistente(movimentoDuplicado);
                      onClose();
                    }}
                    style={{
                      flex: 1,
                      backgroundColor: 'var(--brand-primary)',
                      color: 'var(--text-inverse)',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      padding: '10px 14px',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                    }}
                  >
                    <ExternalLink size={16} />
                    Ver Lançamento no Extrato
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMovimentoDuplicado(null);
                    setUltimoPayloadLido(null);
                  }}
                  style={{
                    backgroundColor: 'transparent',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '10px 14px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Voltar / Ler Outra Nota
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Spinner de Consulta */}
              {consultando && (
                <div
                  style={{
                    padding: '24px',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '12px',
                    color: 'var(--brand-primary)',
                  }}
                >
                  <RefreshCw size={28} className="animate-spin" />
                  <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                    Consultando e verificando dados da nota fiscal...
                  </span>
                </div>
              )}

              {/* Mensagem de Erro */}
              {erroConsulta && !consultando && (
                <div
                  style={{
                    marginBottom: '16px',
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid var(--status-red)',
                    color: 'var(--status-red)',
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <AlertTriangle size={18} />
                  <span>{erroConsulta}</span>
                </div>
              )}

              {/* ABA 1: SCANNER DE QR CODE */}
              {abaAtiva === 'SCANNER' && !consultando && (
                <div>
                  <div
                    style={{
                      position: 'relative',
                      borderRadius: 'var(--radius-md)',
                      overflow: 'hidden',
                      backgroundColor: '#000',
                      minHeight: '280px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <div id="reader-qr-viewfinder" style={{ width: '100%' }}></div>

                    {erroCamera && (
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          padding: '20px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          textAlign: 'center',
                          backgroundColor: 'rgba(0, 0, 0, 0.85)',
                          color: '#fff',
                          gap: '12px',
                        }}
                      >
                        <AlertTriangle size={32} color="var(--status-yellow)" />
                        <span style={{ fontSize: '0.85rem', lineHeight: 1.4 }}>{erroCamera}</span>
                        <button
                          type="button"
                          onClick={() => setAbaAtiva('DIGITACAO')}
                          style={{
                            background: 'var(--brand-primary)',
                            color: 'var(--text-inverse)',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '8px 16px',
                            fontSize: '0.82rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Ir para Digitação Manual
                        </button>
                      </div>
                    )}
                  </div>

                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '12px' }}>
                    Aponte a câmera para o QR Code impresso no cupom da NFC-e. A detecção e preenchimento são imediatos.
                  </p>
                </div>
              )}

              {/* ABA 2: DIGITAÇÃO MANUAL DA CHAVE DE 44 DÍGITOS */}
              {abaAtiva === 'DIGITACAO' && !consultando && (
                <form onSubmit={handleDigitarChaveSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <label className="form-label" style={{ margin: 0 }}>
                        Chave de Acesso da Nota (44 dígitos)
                      </label>
                      <button
                        type="button"
                        onClick={handleColarClipboard}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--brand-primary)',
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <Copy size={13} /> Colar
                      </button>
                    </div>

                    <textarea
                      rows={3}
                      value={chaveDigitada}
                      onChange={(e) => setChaveDigitada(formatarChaveEmBlocos(e.target.value))}
                      placeholder="Ex: 3526 0312 3456 7800 0195 6500 1000 1234 5611 2345 6789"
                      style={{
                        width: '100%',
                        padding: '12px',
                        borderRadius: 'var(--radius-sm)',
                        border: chaveValida
                          ? '1px solid var(--status-green)'
                          : '1px solid var(--border-color)',
                        backgroundColor: 'var(--bg-card)',
                        color: 'var(--text-primary)',
                        fontFamily: 'monospace',
                        fontSize: '0.9rem',
                        letterSpacing: '1px',
                        resize: 'none',
                      }}
                    />

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '0.75rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>
                        Dígitos: {chaveDigitada.replace(/\D/g, '').length} / 44
                      </span>
                      {chaveValida ? (
                        <span style={{ color: 'var(--status-green)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                          <CheckCircle2 size={13} /> Chave e DV válidos
                        </span>
                      ) : chaveDigitada.replace(/\D/g, '').length === 44 ? (
                        <span style={{ color: 'var(--status-red)', fontWeight: 600 }}>
                          Dígito verificador inválido
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={!chaveValida || consultando}
                    style={{
                      backgroundColor: chaveValida ? 'var(--brand-primary)' : 'var(--bg-card)',
                      color: chaveValida ? 'var(--text-inverse)' : 'var(--text-muted)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '12px',
                      fontSize: '0.9rem',
                      fontWeight: 700,
                      cursor: chaveValida ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      transition: 'all 0.2s',
                    }}
                  >
                    <Check size={18} />
                    Validar e Carregar Dados da Nota
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
