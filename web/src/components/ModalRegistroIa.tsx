import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Key,
  Copy,
  ExternalLink,
  Coins,
  ShieldAlert,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Sliders,
} from 'lucide-react';
import {
  apiService,
  ContaItem,
  CategoriaTreeItem,
} from '../api.ts';

export type ModoIa = 'CREDITOS' | 'API_PROPRIA' | 'EXTERNO';

export interface LancamentoParsedIa {
  descricao: string;
  valor: number;
  dataMovimento: string;
  natureza: 'DESPESA' | 'RECEITA' | 'TRANSFERENCIA_PROPRIA' | 'APORTE_PATRIMONIAL';
  contaId?: string | null;
  categoriaId?: string | null;
  isPagamentoFatura?: boolean;
  parcelasTotal?: number | null;
  parcelaAtual?: number | null;
  observacao?: string | null;
}

interface ModalRegistroIaProps {
  contas: ContaItem[];
  categorias: CategoriaTreeItem[];
  onParsedSucesso: (lancamento: LancamentoParsedIa) => void;
  onCancelar: () => void;
}

export const ModalRegistroIa: React.FC<ModalRegistroIaProps> = ({
  contas,
  categorias,
  onParsedSucesso,
  onCancelar,
}) => {
  // 1. Consentimento e Aviso Legal (armazenado em localStorage)
  const [avisoAceito, setAvisoAceito] = useState<boolean>(() => {
    return localStorage.getItem('evolvi_ia_aviso_aceito') === 'true';
  });

  // 2. Abas das 3 Modalidades
  const [modoAtivo, setModoAtivo] = useState<ModoIa>('CREDITOS');

  // Configurações de API Própria (BYOK) salvas em localStorage
  const [provedor, setProvedor] = useState<'GEMINI' | 'OPENAI' | 'ANTHROPIC'>('GEMINI');
  const [modelo, setModelo] = useState('gemini-2.5-flash');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('evolvi_ia_byok_key') || '');
  const [testandoChave, setTestandoChave] = useState(false);
  const [msgChave, setMsgChave] = useState<{ sucesso: boolean; texto: string } | null>(null);

  // Modo Externo: Prompt exportável e colagem de retorno
  const [promptExportavel, setPromptExportavel] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [jsonColadoExterno, setJsonColadoExterno] = useState('');

  // Texto de entrada para Modo Créditos e BYOK
  const [inputLinguagemNatural, setInputLinguagemNatural] = useState('');
  const [processando, setProcessando] = useState(false);
  const [erroProcessamento, setErroProcessamento] = useState<string | null>(null);

  // Saldo de créditos simulado
  const [saldoCreditos, setSaldoCreditos] = useState<number>(50);

  // Carrega prompt exportável ao selecionar aba EXTERNO
  useEffect(() => {
    if (modoAtivo === 'EXTERNO' && !promptExportavel) {
      apiService.getContextoIa().then((res) => {
        if (res?.promptExportavel) {
          setPromptExportavel(res.promptExportavel);
        }
      }).catch(() => {
        setPromptExportavel('Você é o assistente inteligente do Evolvi...');
      });
    }
  }, [modoAtivo, promptExportavel]);

  const handleSalvarChave = (novaChave: string) => {
    setApiKey(novaChave);
    localStorage.setItem('evolvi_ia_byok_key', novaChave);
  };

  const handleTestarChave = async () => {
    if (!apiKey) return;
    setTestandoChave(true);
    setMsgChave(null);
    try {
      const res = await apiService.testarApiKeyIa({
        provedor,
        apiKey,
        modelo,
      });
      setMsgChave({ sucesso: res.sucesso, texto: res.message });
    } catch (err: any) {
      setMsgChave({ sucesso: false, texto: err.message || 'Falha ao validar chave.' });
    } finally {
      setTestandoChave(false);
    }
  };

  const handleCopiarPrompt = () => {
    if (!promptExportavel) return;
    navigator.clipboard.writeText(promptExportavel);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  };

  const handleProcessarIa = async () => {
    const textoFinal = modoAtivo === 'EXTERNO' ? jsonColadoExterno : inputLinguagemNatural;
    if (!textoFinal.trim()) {
      setErroProcessamento('Por favor, informe o texto do lançamento.');
      return;
    }

    setProcessando(true);
    setErroProcessamento(null);

    try {
      const res = await apiService.parseIa({
        texto: textoFinal,
        modo: modoAtivo,
        provedor: modoAtivo === 'API_PROPRIA' ? provedor : undefined,
        modelo: modoAtivo === 'API_PROPRIA' ? modelo : undefined,
        apiKey: modoAtivo === 'API_PROPRIA' ? apiKey : undefined,
      });

      if (res?.lancamento) {
        if (modoAtivo === 'CREDITOS') {
          setSaldoCreditos((prev) => Math.max(0, prev - 1));
        }

        // Tenta mapear contaId e categoriaId se vieram apenas nomes sugeridos
        let finalContaId = res.lancamento.contaId;
        if (!finalContaId && res.lancamento.contaNomeSugerida) {
          const matchC = contas.find(c => c.nome.toLowerCase().includes(res.lancamento.contaNomeSugerida!.toLowerCase()));
          if (matchC) finalContaId = matchC.id;
        }

        let finalCategoriaId = res.lancamento.categoriaId;
        if (!finalCategoriaId && res.lancamento.categoriaNomeSugerida) {
          const matchCat = categorias.find(cat => cat.nome.toLowerCase().includes(res.lancamento.categoriaNomeSugerida!.toLowerCase()));
          if (matchCat) finalCategoriaId = matchCat.id;
        }

        onParsedSucesso({
          descricao: res.lancamento.descricao,
          valor: res.lancamento.valor,
          dataMovimento: res.lancamento.dataMovimento,
          natureza: res.lancamento.natureza,
          contaId: finalContaId || (contas[0]?.id ?? null),
          categoriaId: finalCategoriaId || (categorias[0]?.id ?? null),
          isPagamentoFatura: res.lancamento.isPagamentoFatura ?? false,
          parcelasTotal: res.lancamento.parcelasTotal,
          parcelaAtual: res.lancamento.parcelaAtual,
          observacao: res.lancamento.observacao,
        });
      }
    } catch (err: any) {
      setErroProcessamento(err.message || 'Erro ao processar com a IA.');
    } finally {
      setProcessando(false);
    }
  };

  // Se o usuário ainda não aceitou o aviso legal obrigatório
  if (!avisoAceito) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '4px' }}>
        <div style={{
          padding: '16px',
          borderRadius: 'var(--radius-md)',
          background: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--status-yellow)' }}>
            <ShieldAlert size={28} />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>Aviso Legal e Uso de IA</h3>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            As funcionalidades de inteligência artificial utilizam Modelos de Linguagem (LLMs) para interpretar mensagens e comprovantes financeiros.
          </p>
          <ul style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', paddingLeft: '18px', lineHeight: 1.6 }}>
            <li><strong>Revisão Obrigatória:</strong> A IA pode cometer erros ou alucinações. Você sempre revisará os dados antes de gravar.</li>
            <li><strong>Anti-Dupla Contagem:</strong> Pagamentos de fatura são classificados como transferências para não inflar despesas.</li>
            <li><strong>Privacidade:</strong> Suas chaves de API próprias (BYOK) são armazenadas apenas no seu navegador.</li>
          </ul>
        </div>

        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            localStorage.setItem('evolvi_ia_aviso_aceito', 'true');
            setAvisoAceito(true);
          }}
          style={{ width: '100%' }}
        >
          Li e Concordo com os Termos <ArrowRight size={16} />
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Abas das 3 Modalidades Inspiradas no MacroDroid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: '6px',
        background: 'rgba(15, 23, 42, 0.8)',
        padding: '4px',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-subtle)',
      }}>
        <button
          type="button"
          onClick={() => setModoAtivo('CREDITOS')}
          style={{
            padding: '8px 4px',
            borderRadius: '6px',
            border: 'none',
            fontSize: '0.78rem',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
            backgroundColor: modoAtivo === 'CREDITOS' ? 'var(--brand-primary)' : 'transparent',
            color: modoAtivo === 'CREDITOS' ? 'var(--text-inverse)' : 'var(--text-secondary)',
            transition: 'all 0.2s',
          }}
        >
          <Coins size={14} /> Créditos
        </button>

        <button
          type="button"
          onClick={() => setModoAtivo('API_PROPRIA')}
          style={{
            padding: '8px 4px',
            borderRadius: '6px',
            border: 'none',
            fontSize: '0.78rem',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
            backgroundColor: modoAtivo === 'API_PROPRIA' ? 'var(--brand-primary)' : 'transparent',
            color: modoAtivo === 'API_PROPRIA' ? 'var(--text-inverse)' : 'var(--text-secondary)',
            transition: 'all 0.2s',
          }}
        >
          <Key size={14} /> Chave (BYOK)
        </button>

        <button
          type="button"
          onClick={() => setModoAtivo('EXTERNO')}
          style={{
            padding: '8px 4px',
            borderRadius: '6px',
            border: 'none',
            fontSize: '0.78rem',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
            backgroundColor: modoAtivo === 'EXTERNO' ? 'var(--brand-primary)' : 'transparent',
            color: modoAtivo === 'EXTERNO' ? 'var(--text-inverse)' : 'var(--text-secondary)',
            transition: 'all 0.2s',
          }}
        >
          <ExternalLink size={14} /> Externo
        </button>
      </div>

      {/* Conteúdo Aba 1: Créditos de IA */}
      {modoAtivo === 'CREDITOS' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'rgba(56, 189, 248, 0.08)',
            border: '1px solid rgba(56, 189, 248, 0.2)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Coins size={18} color="var(--brand-primary)" />
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Saldo Disponível:</span>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--brand-primary)' }}>
              {saldoCreditos} créditos
            </span>
          </div>

          <div className="form-group">
            <label className="form-label">Digite ou cole a mensagem/comprovante:</label>
            <textarea
              className="form-input"
              rows={3}
              placeholder="Ex: Almoço executivo no restaurante X R$ 45,00 no cartão Nubank"
              value={inputLinguagemNatural}
              onChange={(e) => setInputLinguagemNatural(e.target.value)}
              style={{ resize: 'none', fontSize: '0.88rem' }}
            />
          </div>
        </div>
      )}

      {/* Conteúdo Aba 2: Usar API Própria (BYOK) */}
      {modoAtivo === 'API_PROPRIA' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div className="form-group">
              <label className="form-label">Provedor LLM</label>
              <select
                className="form-select"
                value={provedor}
                onChange={(e) => setProvedor(e.target.value as any)}
              >
                <option value="GEMINI">Google Gemini</option>
                <option value="OPENAI">OpenAI</option>
                <option value="ANTHROPIC">Anthropic Claude</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Modelo</label>
              <input
                type="text"
                className="form-input"
                value={modelo}
                onChange={(e) => setModelo(e.target.value)}
                placeholder="Ex: gemini-2.5-flash"
              />
            </div>
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="form-label">Chave de API (Armazenada Localmente)</label>
              <button
                type="button"
                onClick={handleTestarChave}
                disabled={testandoChave || !apiKey}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--brand-primary)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                {testandoChave ? <RefreshCw size={12} className="spinning" /> : <Sliders size={12} />}
                Testar Conexão
              </button>
            </div>
            <input
              type="password"
              className="form-input"
              placeholder="Cole sua chave de API aqui"
              value={apiKey}
              onChange={(e) => handleSalvarChave(e.target.value)}
            />
          </div>

          {msgChave && (
            <div style={{
              padding: '8px 12px',
              borderRadius: '6px',
              fontSize: '0.78rem',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: msgChave.sucesso ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: msgChave.sucesso ? 'var(--status-green)' : 'var(--status-red)',
            }}>
              {msgChave.sucesso ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
              {msgChave.texto}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Lançamento em Linguagem Natural:</label>
            <textarea
              className="form-input"
              rows={2}
              placeholder="Ex: Paguei R$ 180,00 na Copel via débito hoje"
              value={inputLinguagemNatural}
              onChange={(e) => setInputLinguagemNatural(e.target.value)}
              style={{ resize: 'none', fontSize: '0.88rem' }}
            />
          </div>
        </div>
      )}

      {/* Conteúdo Aba 3: Usar Externamente (Prompt Exportável) */}
      {modoAtivo === 'EXTERNO' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'rgba(30, 41, 59, 0.5)',
            border: '1px solid var(--border-subtle)',
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}>
            1. Copie o prompt estruturado abaixo contendo suas contas e categorias POF.<br />
            2. Cole no seu chatbot favorito (ChatGPT, Claude ou Gemini Web) junto com seu comprovante.<br />
            3. Cole a resposta JSON de volta no campo abaixo.
          </div>

          <button
            type="button"
            className="btn-secondary"
            onClick={handleCopiarPrompt}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          >
            {copiado ? <CheckCircle size={16} color="var(--status-green)" /> : <Copy size={16} />}
            {copiado ? 'Prompt Copiado para a Área de Transferência!' : 'Copiar Prompt com Contexto'}
          </button>

          <div className="form-group">
            <label className="form-label">Cole o retorno JSON do chatbot aqui:</label>
            <textarea
              className="form-input"
              rows={3}
              placeholder='Cole aqui o JSON retornado pela IA externa...'
              value={jsonColadoExterno}
              onChange={(e) => setJsonColadoExterno(e.target.value)}
              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', resize: 'none' }}
            />
          </div>
        </div>
      )}

      {erroProcessamento && (
        <div style={{
          padding: '8px 12px',
          borderRadius: '6px',
          fontSize: '0.8rem',
          backgroundColor: 'rgba(239, 68, 68, 0.15)',
          color: 'var(--status-red)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <AlertTriangle size={14} />
          {erroProcessamento}
        </div>
      )}

      {/* Botões de Ação */}
      <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
        <button
          type="button"
          className="btn-secondary"
          onClick={onCancelar}
          style={{ flex: 1 }}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={handleProcessarIa}
          disabled={processando}
          style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
        >
          {processando ? (
            <>
              <RefreshCw size={16} className="spinning" />
              Interpretando...
            </>
          ) : (
            <>
              <Sparkles size={16} />
              Interpretar e Revisar
            </>
          )}
        </button>
      </div>
    </div>
  );
};
