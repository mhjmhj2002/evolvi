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
- **Atualização obrigatória de status de demandas**: Sempre que uma demanda/task for finalizada, atualizar seu status no documento de acompanhamento correspondente (por exemplo, `.local/documentacao/ANDAMENTO_DEMANDAS.md`) na mesma entrega. Atualizar também contagens ou resumos de progresso relacionados, quando existirem; não deixar a implementação concluída marcada como não iniciada ou em andamento.

---

## 4. 🧭 Skills de Extração Financeira

O sistema mantém uma base universal e pode acrescentar **skills de instrução para IA específicas por instituição**, com fallback genérico:
- **Permitido:** skills em linguagem natural que ensinem o LLM a reconhecer as seções e o significado dos campos de um documento de instituição conhecida. Uma skill específica complementa a base genérica; não a substitui.
- **Proibido:** parsers, filtros de linhas, regexes de extração, heurísticas ou outras lógicas determinísticas de conteúdo específicas por banco/instituição. A skill orienta a IA; não deve virar código que interprete lançamentos pelo layout proprietário.
- **Fallback obrigatório:** se não houver skill compatível, aplicar a skill genérica e pedir revisão quando a função de uma seção ou data não puder ser identificada com confiança.
- **Fonte canônica:** em extratos com movimentação contabilizada e comprovantes anexos, somente as linhas da movimentação contabilizada geram lançamentos. Comprovantes servem como evidência, não como uma segunda transação; a data e o valor do lançamento vêm da movimentação contabilizada.
- **Formatos universais padrão:** regras determinísticas só são aceitas para formatos abertos e estruturados padronizados por norma (como especificação oficial OFX, CSVs padrão e Open Finance), nunca atreladas a layouts proprietários.
- **Robustez universal:** paginação, volume e layout desconhecido devem continuar usando estratégias gerais (por exemplo, chunks por tamanho/página e validação de cobertura), sem código específico por instituição.

---

## 5. 🗄️ Pré-requisito obrigatório para testes com PostgreSQL

Os testes de integração usam o PostgreSQL definido em `docker-compose.yml` e a conexão configurada em `.env` (`localhost:5432`). Antes de executar `npm run test:run`, o agente deve:

1. Subir ou garantir o serviço: `docker compose up -d postgres`.
2. Aguardar o healthcheck e validar a conexão: `docker exec evolvi_postgres pg_isready -U evolvi -d evolvi_db`.
3. Aplicar migrações pendentes: `npx prisma migrate deploy`.
4. Executar `npm run test:run` no mesmo contexto de rede que alcança `localhost:5432`.

Se o sandbox não conseguir acessar `localhost:5432`, não concluir que a aplicação está sem banco nem repetir a suíte nesse contexto: solicitar/usar execução privilegiada para os comandos Docker, migrações e testes. Não usar `prisma migrate reset`, apagar volumes ou recriar o banco, pois isso pode destruir dados locais.

