# Diretrizes para Agentes de IA (AGENTS.md)

Este documento define regras fundamentais e mandatórias de estilo, padronização e documentação para agentes autônomos e assistentes de IA neste repositório.

---

## 1. 🔗 Regra Estrita de Links em Arquivos Markdown (`.md`)

- **NUNCA use links absolutos**:
  - Proibido usar prefixo de protocolo local como `file:///...`
  - Proibido usar caminhos absolutos do sistema operacional como `/home/...` ou `C:\...`
- **SEMPRE use links relativos**:
  - Todo link para outro arquivo, módulo, tela ou documentação deve ser relativo à localização do arquivo markdown atual.
  - Exemplo correto: `[TelaImportacaoIa.tsx](../web/src/screens/TelaImportacaoIa.tsx)`
  - Exemplo incorreto: `[TelaImportacaoIa.tsx](file:///home/mhj/git/evolvi/web/src/screens/TelaImportacaoIa.tsx)`

---

## 2. 📊 Estética e Clareza de Diagramas Mermaid

Diagramas em markdown devem **facilitar a compreensão imediata** da arquitetura e do fluxo, nunca sobrecarregar ou complicar:
- **Fluxo limpo e direcional**: Prefira fluxos organizados em colunas ou linhas claras com etapas numeradas concisas.
- **Rótulos curtos e objetivos**: Evite textos longos dentro de nós e arestas. Mantenha os nomes focados na ação ou entidade.
- **Estruturação por Subgrafos e Cores/Estilos**: Agrupe responsabilidades logicamente (ex.: *Frontend*, *Backend*, *Fila/Workers*, *Banco de Dados*).
- **Sem cruzamento caótico de linhas**: Evite diagramas em que dezenas de setas se cruzam desordenadamente gerando poluição visual ("salada de letras").

---

## 3. 🛡️ Padrões Gerais de Desenvolvimento

- **Preservação de Contexto e Testes**: Sempre execute e garanta que suítes de testes (`npm run test:run`) e compilações (`npm run build:web`) passem com 100% de sucesso após alterações.
- **Segurança Multi-Tenant**: Toda consulta e persistência no banco de dados deve sempre isolar registros pelo `usuarioId` autenticado.
- **Clareza na Documentação**: Documentos devem ter seções bem delineadas, tabelas sintetizadas e passos cronológicos diretos.
