# 🤖 Fluxo Completo de Importação de Lançamentos com IA (Plano A)

Este documento descreve de forma didática e visual a arquitetura e o ciclo de vida completo da **Importação Inteligente de Lançamentos por IA**, desde o upload de documentos até a efetivação no extrato financeiro do usuário logado.

---

## 📌 Visão Panorâmica da Arquitetura Contínua e Assíncrona

O ecossistema opera como uma **esteira contínua assíncrona orientada a eventos**. O upload apenas recepciona e persiste os arquivos no disco e no banco; a partir deste momento, os workers trabalham de forma fluida sem bloqueios globais:

- **Worker 1 (IA):** Lê e extrai os lançamentos de cada arquivo de forma sequencial (1 arquivo por vez).
- **Worker 2 (Staging):** **Não espera** a IA processar todos os arquivos do lote. Assim que a IA conclui um arquivo (`EVENT_ARQUIVO_CONSOLIDADO_PRONTO`), este arquivo é imediatamente carregado na tabela de Staging.
- **Worker 3 (Consolidação):** **Não espera** todos os arquivos. Conforme cada arquivo entra na Staging (`EVENT_ARQUIVO_STAGING_CARREGADO`), o Worker 3 consolida seus lançamentos, provisiona contas e aplica deduplicação. O lote só é marcado como `CONCLUIDO` quando **todos** os arquivos atingirem status terminal (`PROCESSADO_FINAL` ou `ERRO`).

```mermaid
flowchart TD
    %% ==========================================
    %% SUBGRAFOS / CAMADAS DO SISTEMA
    %% ==========================================
    subgraph S1["1. Interface do Usuário (Frontend)"]
        A1["👤 Usuário"]
        A2["💻 Tela de Importação<br/>(Upload de Arquivos/Pastas)"]
        A3["📊 Painel 4 Barras de Progresso<br/>(Upload, IA, Staging, Consolidação)"]
        A4["📡 Feed ao Vivo<br/>(Eventos SSE)"]
    end

    subgraph S2["2. Ingestão & Armazenamento (Backend)"]
        B1["⚙️ API de Upload<br/>(POST /api/importacao/upload)"]
        B2["📁 Disco Temporário<br/>UPLOADS_DIR/usuarioId/lote/"]
        B3["📢 Barramento de Eventos<br/>(importacaoEventBus)"]
    end

    subgraph S3["3. Processamento com IA (Worker 1)"]
        C1["⚡ Worker IA<br/>(1 arquivo por vez)"]
        C2["🧠 Motor IA (Gemini/OpenAI/Claude)<br/>(Contexto do Usuário)"]
        C3["📄 JSON Consolidado<br/>(consolidado_arquivoId.json)"]
    end

    subgraph S4["4. Validação & Staging (Worker 2)"]
        D1["⚡ Worker Staging<br/>(Disparo imediato por arquivo)"]
        D2[("🗄️ Tabela Staging<br/>(staging_lancamentos)")]
    end

    subgraph S5["5. Regras de Negócio & Consolidação (Worker 3)"]
        E1["⚡ Worker Consolidação<br/>(Streaming por arquivo carregado)"]
        E2[("💳 Contas Bancárias<br/>(Auto-provisionamento)")]
        E3[("📊 Extrato Oficial<br/>(movimentos & parcelamentos)")]
    end

    %% ==========================================
    %% FLUXO SEQUENCIAL DE ETAPAS
    %% ==========================================
    %% 1 -> 2: Upload
    A1 -->|"1. Seleciona arquivos"| A2
    A2 -->|"2. Envio multipart"| B1
    B1 -->|"3. Salva em disco"| B2
    B1 -->|"4. Resposta 202 com contagem"| A2
    B1 -->|"5. Dispara evento lote_recepcionado"| B3

    %% 2 -> 3: IA
    B3 -->|"6. Inicia fila sequencial"| C1
    C1 -->|"7. Extrai transações"| C2
    C2 -->|"8. Validação Zod"| C1
    C1 -->|"9. Grava arquivo físico"| C3
    C1 -->|"10. Emite arquivo_consolidado_pronto"| B3

    %% 3 -> 4: Staging imediato (sem esperar outros arquivos)
    B3 -->|"11. Aciona carga do arquivo"| D1
    C3 -.->|"Lê arquivo"| D1
    D1 -->|"12. Bulk insert em staging"| D2
    D1 -->|"13. Emite arquivo_staging_carregado"| B3

    %% 4 -> 5: Consolidação imediata (sem esperar lote)
    B3 -->|"14. Aciona consolidação"| E1
    D2 -.->|"Lê pendentes"| E1
    E1 -->|"15. Auto-cadastra contas"| E2
    E1 -->|"16. Grava lançamentos finais"| E3
    E1 -->|"17. Atualiza arquivo para PROCESSADO_FINAL"| E3

    %% Notificações em Tempo Real
    B3 -.->|"Atualização contínua das barras"| A3
    B3 -.->|"Transações ao vivo"| A4

    %% ==========================================
    %% PALETA DE CORES MODERNA & HARMONIOSA
    %% ==========================================
    classDef front fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,color:#0369a1;
    classDef ingest fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#92400e;
    classDef ai fill:#ffe4e6,stroke:#e11d48,stroke-width:2px,color:#9f1239;
    classDef staging fill:#f3e8ff,stroke:#9333ea,stroke-width:2px,color:#6b21a8;
    classDef final fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#166534;

    class A1,A2,A3,A4 front;
    class B1,B2,B3 ingest;
    class C1,C2,C3 ai;
    class D1,D2 staging;
    class E1,E2,E3 final;
```

---

## 🧭 Diagrama de Sequência e Interações no Tempo

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 Usuário
    participant UI as 💻 Frontend (TelaImportacaoIa)
    participant API as ⚙️ Backend API
    participant W1 as ⚡ Worker 1 (IA)
    participant W2 as ⚡ Worker 2 (Staging)
    participant W3 as ⚡ Worker 3 (Consolidação)
    participant DB as 🗄️ PostgreSQL

    %% 1. Ingestão
    rect rgb(238, 242, 255)
        Note over User, API: 1. Ingestão e Recebimento
        User->>UI: Seleciona arquivos ou pasta inteira
        UI->>API: POST /api/importacao/upload (multipart)
        API->>DB: Registra Lote e Arquivos (RECEPCIONADO)
        API-->>UI: HTTP 202 Accepted (loteId com totalArquivos)
        UI->>User: Exibe Painel com 4 Barras de Progresso
    end

    %% 2. Pipeline Contínuo e Assíncrono (Streaming por Arquivo)
    rect rgb(253, 242, 248)
        Note over W1, DB: 2. Pipeline Fluido por Arquivo
        API-)W1: Dispara evento lote_recepcionado
        loop Para cada arquivo do lote
            W1->>W1: Extrai dados com IA e salva consolidado.json
            W1->>DB: Atualiza Arquivo para IA_CONCLUIDO
            W1-)W2: Emite arquivo_consolidado_pronto
            critical Execução Concorrente em Pipeline
                W2->>DB: Bulk insert na staging e atualiza status para STAGING_CARREGADO
                W2-)W3: Emite arquivo_staging_carregado
                W3->>DB: Deduplicação + Auto-cadastro + Grava movimentos oficiais
                W3->>DB: Atualiza Arquivo para PROCESSADO_FINAL
                W3-)UI: SSE: transacao_consolidada (feed ao vivo)
            end
        end
    end

    %% 3. Fechamento do Lote
    rect rgb(236, 253, 245)
        Note over W3, DB: 3. Fechamento Seguro do Lote
        W3->>DB: Verifica se todos os arquivos estão em PROCESSADO_FINAL ou ERRO
        W3->>DB: Atualiza Lote para CONCLUIDO
        W3-)UI: SSE: lote_concluido
        UI->>User: ✅ 100% Concluído nas 4 barras (Extrato atualizado)
    end
```

---

## 🔄 Detalhamento das 5 Etapas do Pipeline

### 1. Seleção e Envio no Frontend ([`TelaImportacaoIa.tsx`](../web/src/screens/TelaImportacaoIa.tsx))
- **Seleção flexível:** O usuário pode arrastar múltiplos arquivos (`.pdf`, `.csv`, `.ofx`, `.txt`, imagens) ou selecionar uma pasta inteira do computador.
- **Contagem Imediata:** Ao subir o lote, já registra a quantidade total de arquivos no banco.
- **Painel de 4 Barras de Progresso Independentes:**
  1. **Upload & Storage:** `X de N (100%)` - arquivos físicos persistidos no servidor.
  2. **Extração IA:** `X de N (% concluída)` - contagem exata de arquivos já lidos pelo modelo.
  3. **Carga Staging:** `X de N (% concluída)` + total de linhas inseridas na staging.
  4. **Consolidação Final:** `X de N (% concluída)` + total de lançamentos oficiais criados no extrato.
- **Telas de Detalhe por Worker:** Abas específicas com visão granular para o *Worker 1 (IA)*, *Worker 2 (Staging)* e *Worker 3 (Consolidação)*.
- **Botões Automáticos com Modo Contingência:** Todo o fluxo ocorre de forma automática e assíncrona; os botões manuais passam a ser utilizados apenas como opção de contingência ou re-tentativa.

---

### 2. Ingestão e Armazenamento ([`ImportacaoStorageService`](../src/modules/importacao/importacao-storage.service.ts))
- **Diretório seguro:** Arquivos salvos em pasta física isolada, com **uma subpasta por usuário**:
  ```
  {UPLOADS_DIR}/{usuarioId}/yyyy-mm-dd-hh-mm-ss-{usuarioId}/
  ```
  `UPLOADS_DIR` vem da variável de ambiente homônima (padrão: `uploads`, relativo à raiz do projeto). O caminho persistido em `LoteImportacao.caminhoDiretorio` permanece **relativo** quando `UPLOADS_DIR` é relativo, e é resolvido pelos leitores via `path.resolve(process.cwd(), caminhoDiretorio)`.
- **Sanitização de caminhos:** Bloqueio de *Path Traversal* (rejeição de `../` e paths absolutos).
- **Rastreabilidade no Banco:** Criação atômica em `lotes_importacao` e `arquivos_importacao` com status inicial `RECEPCIONADO`.

---

### 3. Extração Sequencial por IA ([`ImportacaoIaWorkerService`](../src/modules/importacao/worker/importacao-ia-worker.service.ts))
- **Execução 1 a 1:** Os arquivos são processados sequencialmente para proteger quotas e evitar *rate limits*.
- **Injeção de contexto:** O worker envia ao modelo o histórico de contas bancárias e a árvore POF do usuário logado.
- **Disparo Imediato:** Ao concluir cada arquivo, emite imediatamente `EVENT_ARQUIVO_CONSOLIDADO_PRONTO`, destravando o próximo worker.

---

### 4. Carga em Staging ([`ImportacaoStagingWorkerService`](../src/modules/importacao/worker/importacao-staging-worker.service.ts))
- **Execução por Arquivo:** Não espera o lote todo terminar na IA; processa cada arquivo individualmente assim que liberado.
- **Bulk Insert Otimizado:** Insere todos os registros do arquivo em lote via `prisma.stagingLancamentoImportacao.createMany`.
- **Disparo da Consolidação:** Emite `EVENT_ARQUIVO_STAGING_CARREGADO` com a contagem de linhas geradas.

---

### 5. Consolidação e Gravação Oficial ([`ImportacaoConsolidacaoWorkerService`](../src/modules/importacao/worker/importacao-consolidacao-worker.service.ts))
- **Auto-Cadastro de Contas:** Provisiona automaticamente contas bancárias e cartões novos sem travar a importação.
- **Anti-Dupla Contagem:** Pagamentos de faturas de cartão são convertidos para `TRANSFERENCIA_PROPRIA`, impedindo somas duplicadas nas despesas.
- **Deduplicação Determinística:** Hash `SHA-256(contaId + data + valor + descricao)` descarta automaticamente lançamentos já existentes (`IGNORADO`).
- **Conclusão Segura do Lote:** O status `CONCLUIDO` do lote só é atribuído quando **todos** os arquivos tiverem sido finalizados (`PROCESSADO_FINAL` ou `ERRO`), impedindo finalizações prematuras.

---

## 🔒 Matriz de Segurança e Integridade

| Pilar | Mecanismo de Proteção |
|---|---|
| **Multi-Tenancy** | Todas as operações são isoladas estritamente pelo `usuarioId` autenticado. |
| **Sanitização** | Bloqueio rigoroso contra ataques de navegação em diretórios (*Path Traversal*). |
| **Anti-Duplicação** | Hash SHA-256 impede reimportação acidental de extratos repetidos. |
| **Anti-Dupla Contagem** | Regra inteligente para pagamentos de cartão de crédito. |
| **Integridade de Lote** | O lote só é encerrado quando todos os arquivos atingem estado terminal. |

---

## 🛠️ Endpoints REST da Importação

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/api/importacao/upload` | Envia arquivos ou pastas para início do pipeline (HTTP 202). |
| `GET` | `/api/importacao/lotes` | Lista os lotes de importação do usuário. |
| `GET` | `/api/importacao/lotes/:id` | Status detalhado com métricas reais para as 4 barras de progresso. |
| `GET` | `/api/importacao/lotes/:id/staging` | Consulta transações em staging para auditoria e monitoramento. |
| `GET` | `/api/importacao/stream-eventos` | Streaming Server-Sent Events (SSE) com atualizações em tempo real. |
| `POST` | `/api/importacao/lotes/:id/processar-ia` | Disparo manual/contingência da etapa de IA. |
| `POST` | `/api/importacao/lotes/:id/carregar-staging` | Disparo manual/contingência da etapa de staging. |
| `POST` | `/api/importacao/lotes/:id/consolidar` | Disparo manual/contingência da etapa de consolidação final. |

