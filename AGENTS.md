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

---

## 4. 🚫 Proibição de Regras Específicas por Instituição de Pagamento / Banco

O sistema Evolvi adota arquitetura **100% agnóstica e universal** para ingestão e extração de documentos financeiros (extratos, faturas, comprovantes):
- **PROIBIDO criar parsers, heurísticas ou lógicas determinísticas específicas por banco ou instituição de pagamento** (ex.: regras customizadas para Itaú, Banco do Brasil, Caixa, Bradesco, Santander, Nubank, etc.).
- **Extração guiada por IA**: A interpretação de layout e campos em documentos não-estruturados (PDFs, imagens e textos livres) deve ser estritamente responsabilidade dos motores de IA (LLMs) via prompts universais e contextuais (contas do usuário, categorias POF, titularidade).
- **Formatos universais padrão**: Regras determinísticas só são aceitas para formatos abertos e estruturados padronizados por norma (como especificação oficial OFX, CSVs padrão e Open Finance), nunca atreladas à marca, layout proprietário ou peculiaridades de uma instituição específica.
- **Robustez universal**: Qualquer desafio de paginação, volume de dados ou layout deve ser resolvido através de estratégias genéricas (ex.: compactação de schema JSON, chunks universais por tamanho/página, diretrizes de exaustividade nos prompts), garantindo que funcione para qualquer uma das centenas de instituições financeiras do Brasil sem alteração de código.

