import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Key,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Server,
  RefreshCw,
} from 'lucide-react';
import { apiService, StatusIaResponse } from '../api.ts';

interface ConfiguracaoIaCardProps {
  onChaveAtualizada?: (configurada: boolean) => void;
  modoModal?: boolean;
  onFecharModal?: () => void;
}

export const ConfiguracaoIaCard: React.FC<ConfiguracaoIaCardProps> = ({
  onChaveAtualizada,
  modoModal = false,
  onFecharModal,
}) => {
  const [statusIa, setStatusIa] = useState<StatusIaResponse | null>(null);

  // Provedor selecionado
  const [provedor, setProvedor] = useState<'GEMINI' | 'OPENAI' | 'ANTHROPIC'>('GEMINI');
  const [modelo, setModelo] = useState('gemini-2.5-flash');
  const [apiKey, setApiKey] = useState('');
  const [mostrarChave, setMostrarChave] = useState(false);

  // Ações de teste e salvamento
  const [testando, setTestando] = useState(false);
  const [feedback, setFeedback] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [guiaAberto, setGuiaAberto] = useState<'GEMINI' | 'OPENAI' | 'ANTHROPIC' | null>('GEMINI');

  const carregarStatus = async () => {
    try {
      const res = await apiService.getStatusIa();
      setStatusIa(res);

      // Carregar do localStorage se existir
      const savedKey = localStorage.getItem('evolvi_ia_byok_key') || '';
      const savedProvedor = (localStorage.getItem('evolvi_ia_byok_provedor') as any) || (res.provedorAtivo || 'GEMINI');
      const savedModelo = localStorage.getItem('evolvi_ia_byok_modelo') || res.modeloPadrao || 'gemini-2.5-flash';

      setApiKey(savedKey);
      setProvedor(savedProvedor);
      setModelo(savedModelo);
      setGuiaAberto(savedProvedor);
    } catch (err: any) {
      console.warn('Erro ao obter status de IA:', err);
    }
  };

  useEffect(() => {
    carregarStatus();
  }, []);

  const handleSalvarChave = () => {
    const keyTrimmed = apiKey.trim();
    if (keyTrimmed) {
      localStorage.setItem('evolvi_ia_byok_key', keyTrimmed);
      localStorage.setItem('evolvi_ia_byok_provedor', provedor);
      localStorage.setItem('evolvi_ia_byok_modelo', modelo);
      setFeedback({ tipo: 'sucesso', texto: 'Chave e configurações salvas no navegador com sucesso!' });
      onChaveAtualizada?.(true);
    } else {
      localStorage.removeItem('evolvi_ia_byok_key');
      localStorage.removeItem('evolvi_ia_byok_provedor');
      localStorage.removeItem('evolvi_ia_byok_modelo');
      setFeedback({ tipo: 'sucesso', texto: 'Chave pessoal removida.' });
      onChaveAtualizada?.(Boolean(statusIa?.hasEnvKey));
    }
  };

  const handleTestarConexao = async () => {
    const keyTrimmed = apiKey.trim();
    if (!keyTrimmed && !statusIa?.hasEnvKey) {
      setFeedback({ tipo: 'erro', texto: 'Informe uma chave de API para testar.' });
      return;
    }

    setTestando(true);
    setFeedback(null);
    try {
      const res = await apiService.testarApiKeyIa({
        provedor,
        apiKey: keyTrimmed,
        modelo,
      });

      if (res.sucesso) {
        setFeedback({ tipo: 'sucesso', texto: res.message || 'Conexão validada com sucesso!' });
        handleSalvarChave();
      } else {
        setFeedback({ tipo: 'erro', texto: res.message || 'Falha na validação da chave.' });
      }
    } catch (err: any) {
      setFeedback({ tipo: 'erro', texto: err.message || 'Erro ao comunicar com a API do provedor.' });
    } finally {
      setTestando(false);
    }
  };

  const handleLimparChave = () => {
    setApiKey('');
    localStorage.removeItem('evolvi_ia_byok_key');
    setFeedback({ tipo: 'sucesso', texto: 'Chave desvinculada.' });
    onChaveAtualizada?.(Boolean(statusIa?.hasEnvKey));
  };

  const isConfigurada = Boolean(statusIa?.hasEnvKey || apiKey.trim().length > 0);

  return (
    <div className="login-card" style={{ maxWidth: '100%', margin: 0 }}>
      {/* 1. Cabeçalho com Status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="login-logo-badge" style={{ width: 44, height: 44, margin: 0 }}>
            <Sparkles size={24} style={{ color: 'var(--brand-primary, #38bdf8)' }} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              Configuração de Inteligência Artificial (LLM)
              {isConfigurada ? (
                <span className="badge badge-verde" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <CheckCircle2 size={13} /> Ativa
                </span>
              ) : (
                <span className="badge badge-amarelo" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <AlertCircle size={13} /> Não Configurada
                </span>
              )}
            </h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
              Permite extrair lançamentos de faturas em PDF, notas fiscais, imagens e texto natural
            </p>
          </div>
        </div>

        {modoModal && onFecharModal && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onFecharModal}
            style={{ padding: '6px 12px', fontSize: '0.82rem' }}
          >
            Fechar
          </button>
        )}
      </div>

      {/* 2. Banner Informativo sobre Origem da Chave */}
      {statusIa?.hasEnvKey ? (
        <div
          style={{
            background: 'rgba(34, 197, 94, 0.08)',
            border: '1px solid rgba(34, 197, 94, 0.25)',
            borderRadius: 'var(--radius-sm)',
            padding: '12px 14px',
            display: 'flex',
            gap: '10px',
            alignItems: 'flex-start',
            fontSize: '0.84rem',
            color: 'var(--text-secondary)',
          }}
        >
          <Server size={18} style={{ color: 'var(--status-green, #22c55e)', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong style={{ color: 'var(--text-primary)' }}>Chave do Servidor Ativa: </strong>
            O servidor já possui uma chave do Google Gemini configurada globalmente via variáveis de ambiente.
            Você pode utilizar a IA imediatamente sem precisar de chave pessoal, ou configurar sua própria chave abaixo (BYOK) para controle individual de cotas.
          </div>
        </div>
      ) : (
        <div
          style={{
            background: 'rgba(234, 179, 8, 0.08)',
            border: '1px solid rgba(234, 179, 8, 0.25)',
            borderRadius: 'var(--radius-sm)',
            padding: '12px 14px',
            display: 'flex',
            gap: '10px',
            alignItems: 'flex-start',
            fontSize: '0.84rem',
            color: 'var(--text-secondary)',
          }}
        >
          <Key size={18} style={{ color: 'var(--status-yellow, #eab308)', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong style={{ color: 'var(--text-primary)' }}>Nenhuma chave global detectada: </strong>
            Para processar faturas em PDF e documentos não estruturados, configure sua chave de API pessoal (BYOK)
            gratuita do Google Gemini ou de outro provedor suportado. A chave é salva com segurança apenas no seu navegador.
          </div>
        </div>
      )}

      {/* 3. Seleção de Provedor e Formulário */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '4px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
          <button
            type="button"
            className={`auth-tab-btn ${provedor === 'GEMINI' ? 'active' : ''}`}
            onClick={() => {
              setProvedor('GEMINI');
              setModelo('gemini-2.5-flash');
              setGuiaAberto('GEMINI');
            }}
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm)',
              border: provedor === 'GEMINI' ? '1px solid var(--brand-primary)' : '1px solid var(--border-color)',
              background: provedor === 'GEMINI' ? 'rgba(56, 189, 248, 0.12)' : 'var(--bg-card)',
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>Google Gemini</span>
              <span className="badge badge-verde" style={{ fontSize: '0.65rem' }}>Recomendado</span>
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Gratuito • Rápido • Multimodal</span>
          </button>

          <button
            type="button"
            className={`auth-tab-btn ${provedor === 'OPENAI' ? 'active' : ''}`}
            onClick={() => {
              setProvedor('OPENAI');
              setModelo('gpt-4o-mini');
              setGuiaAberto('OPENAI');
            }}
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm)',
              border: provedor === 'OPENAI' ? '1px solid var(--brand-primary)' : '1px solid var(--border-color)',
              background: provedor === 'OPENAI' ? 'rgba(56, 189, 248, 0.12)' : 'var(--bg-card)',
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>OpenAI (ChatGPT)</span>
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>GPT-4o • GPT-4o-mini</span>
          </button>

          <button
            type="button"
            className={`auth-tab-btn ${provedor === 'ANTHROPIC' ? 'active' : ''}`}
            onClick={() => {
              setProvedor('ANTHROPIC');
              setModelo('claude-3-5-sonnet-20241022');
              setGuiaAberto('ANTHROPIC');
            }}
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm)',
              border: provedor === 'ANTHROPIC' ? '1px solid var(--brand-primary)' : '1px solid var(--border-color)',
              background: provedor === 'ANTHROPIC' ? 'rgba(56, 189, 248, 0.12)' : 'var(--bg-card)',
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>Anthropic (Claude)</span>
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Claude 3.5 Sonnet / Haiku</span>
          </button>
        </div>

        {/* Campo de Chave e Modelo */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Chave de API ({provedor}):
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={mostrarChave ? 'text' : 'password'}
                className="input"
                placeholder={
                  provedor === 'GEMINI'
                    ? 'Ex: AIzaSy...'
                    : provedor === 'OPENAI'
                    ? 'Ex: sk-proj-...'
                    : 'Ex: sk-ant-...'
                }
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                style={{ width: '100%', paddingRight: '90px', fontFamily: 'monospace', fontSize: '0.85rem' }}
              />
              <button
                type="button"
                onClick={() => setMostrarChave(!mostrarChave)}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '0.72rem',
                  cursor: 'pointer',
                  padding: '2px 6px',
                }}
              >
                {mostrarChave ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleTestarConexao}
              disabled={testando || (!apiKey && !statusIa?.hasEnvKey)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
            >
              <RefreshCw size={14} className={testando ? 'animate-spin' : ''} />
              {testando ? 'Testando...' : 'Testar Conexão'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSalvarChave}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
            >
              <CheckCircle2 size={14} />
              Salvar
            </button>
            {apiKey && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleLimparChave}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', color: 'var(--status-red, #ef4444)' }}
                title="Remover chave salva localmente"
              >
                Limpar
              </button>
            )}
          </div>
        </div>

        {/* Feedback visual */}
        {feedback && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: feedback.tipo === 'sucesso' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              border: feedback.tipo === 'sucesso' ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
              color: feedback.tipo === 'sucesso' ? 'var(--status-green, #22c55e)' : 'var(--status-red, #ef4444)',
            }}
          >
            {feedback.tipo === 'sucesso' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{feedback.texto}</span>
          </div>
        )}
      </div>

      {/* 4. Guia Passo a Passo de Ajuda para cada IA */}
      <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: '0.92rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <HelpCircle size={16} style={{ color: 'var(--brand-primary)' }} />
            Como obter a chave de API (Passo a Passo)
          </h3>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            Clique para expandir as instruções do provedor
          </span>
        </div>

        {/* Guia Gemini */}
        <div
          style={{
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            overflow: 'hidden',
          }}
        >
          <button
            type="button"
            onClick={() => setGuiaAberto(guiaAberto === 'GEMINI' ? null : 'GEMINI')}
            style={{
              width: '100%',
              padding: '10px 14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'var(--bg-secondary)',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-primary)',
              fontWeight: 600,
              fontSize: '0.84rem',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>1. Google Gemini (Gratuito no Google AI Studio)</span>
              <span className="badge badge-verde" style={{ fontSize: '0.65rem' }}>Mais Fácil</span>
            </span>
            {guiaAberto === 'GEMINI' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {guiaAberto === 'GEMINI' && (
            <div style={{ padding: '14px', fontSize: '0.82rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
              <ol style={{ paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <li>
                  Acesse o <strong>Google AI Studio</strong> pelo link oficial:{' '}
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--brand-primary)', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  >
                    aistudio.google.com/app/apikey <ExternalLink size={12} />
                  </a>
                </li>
                <li>Faça login com sua conta Google comum (Gmail).</li>
                <li>Clique no botão azul <strong>"Create API key"</strong> (Criar chave de API).</li>
                <li>Selecione qualquer projeto Google Cloud existente ou escolha <em>"Create API key in new project"</em>.</li>
                <li>Copie a chave gerada (inicia com <code>AIzaSy...</code>) e cole no campo acima.</li>
                <li>Clique em <strong>Testar Conexão</strong> e depois em <strong>Salvar</strong>. Pronto! O plano gratuito permite até 15 requisições por minuto sem custo.</li>
              </ol>
            </div>
          )}
        </div>

        {/* Guia OpenAI */}
        <div
          style={{
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            overflow: 'hidden',
          }}
        >
          <button
            type="button"
            onClick={() => setGuiaAberto(guiaAberto === 'OPENAI' ? null : 'OPENAI')}
            style={{
              width: '100%',
              padding: '10px 14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'var(--bg-secondary)',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-primary)',
              fontWeight: 600,
              fontSize: '0.84rem',
            }}
          >
            <span>2. OpenAI (ChatGPT / platform.openai.com)</span>
            {guiaAberto === 'OPENAI' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {guiaAberto === 'OPENAI' && (
            <div style={{ padding: '14px', fontSize: '0.82rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
              <ol style={{ paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <li>
                  Acesse a plataforma de desenvolvedores da OpenAI:{' '}
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--brand-primary)', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  >
                    platform.openai.com/api-keys <ExternalLink size={12} />
                  </a>
                </li>
                <li>Faça login com sua conta da OpenAI (ChatGPT).</li>
                <li>Clique em <strong>"Create new secret key"</strong>.</li>
                <li>Dê um nome à chave (ex: <em>Evolvi Financeiro</em>) e copie o código secreto (inicia com <code>sk-proj-...</code>).</li>
                <li>Cole no campo acima, selecione o modelo desejado (ex: <code>gpt-4o-mini</code>) e clique em Salvar.</li>
              </ol>
            </div>
          )}
        </div>

        {/* Guia Anthropic */}
        <div
          style={{
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            overflow: 'hidden',
          }}
        >
          <button
            type="button"
            onClick={() => setGuiaAberto(guiaAberto === 'ANTHROPIC' ? null : 'ANTHROPIC')}
            style={{
              width: '100%',
              padding: '10px 14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'var(--bg-secondary)',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-primary)',
              fontWeight: 600,
              fontSize: '0.84rem',
            }}
          >
            <span>3. Anthropic (Claude / console.anthropic.com)</span>
            {guiaAberto === 'ANTHROPIC' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {guiaAberto === 'ANTHROPIC' && (
            <div style={{ padding: '14px', fontSize: '0.82rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
              <ol style={{ paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <li>
                  Acesse o console da Anthropic:{' '}
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--brand-primary)', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  >
                    console.anthropic.com/settings/keys <ExternalLink size={12} />
                  </a>
                </li>
                <li>Faça login ou cadastre-se no console da Anthropic.</li>
                <li>Clique em <strong>"Create Key"</strong>, nomeie a chave e copie o token gerado (inicia com <code>sk-ant-...</code>).</li>
                <li>Cole no campo de chave de API e clique em <strong>Salvar</strong>.</li>
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
