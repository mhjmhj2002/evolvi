# 🤖 Fluxo Completo de Importação de Lançamentos com IA (Plano A)

Este documento descreve de forma didática e visual a arquitetura e o ciclo de vida completo da **Importação Inteligente de Lançamentos por IA**, desde o upload de documentos até a efetivação no extrato financeiro do usuário logado.

---

## 📌 Visão Panorâmica da Arquitetura

O ecossistema é organizado em **5 camadas claras e sequenciais** (*Frontend*, *Ingestão*, *Motor IA*, *Staging* e *Consolidação*):

```mermaid
flowchart TD
    %% ==========================================
    %% SUBGRAFOS / CAMADAS DO SISTEMA
    %% ==========================================
    subgraph S1["1. Interface do Usuário (Frontend)"]
        A1["👤 Usuário"]
        A2["💻 Tela de Importação<br/>(Arrastar arquivos ou pastas)"]
        A3["📡 Feed ao Vivo<br/>(Notificações SSE)"]
    end

    subgraph S2["2. Ingestão & Armazenamento (Backend)"]
        B1["⚙️ API de Upload<br/>(POST /api/importacao/upload)"]
        B2["📁 Disco Temporário<br/>uploads/yyyy-mm-dd.../"]
        B3["📢 Barramento de Eventos<br/>(importacaoEventBus)"]
    end

    subgraph S3["3. Processamento com IA (Worker 1)"]
        C1["⚡ Worker IA<br/>(Execução 1 arquivo por vez)"]
        C2["🧠 Google Gemini 2.5 Flash<br/>(Prompt com contexto do usuário)"]
        C3["📄 JSON Consolidado<br/>(consolidado_arquivoId.json)"]
    end

    subgraph S4["4. Validação & Staging (Worker 2)"]
        D1["⚡ Worker Staging<br/>(Leitura do JSON)"]
        D2[("🗄️ Tabela Staging<br/>(staging_lancamentos)")]
    end

    subgraph S5["5. Regras de Negócio & Consolidação (Worker 3)"]
        E1["⚡ Worker Consolidação<br/>(Dedupe + Anti-dupla contagem)"]
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
    B1 -->|"4. Resposta 202 Accepted"| A2
    B1 -->|"5. Dispara evento lote_recepcionado"| B3

    %% 2 -> 3: IA
    B3 -->|"6. Inicia fila"| C1
    C1 -->|"7. Extrai transações"| C2
    C2 -->|"8. Validação Zod"| C1
    C1 -->|"9. Grava arquivo"| C3
    C1 -->|"10. Dispara consolidado_pronto"| B3

    %% 3 -> 4: Staging
    B3 -->|"11. Inicia staging"| D1
    C3 -.->|"Lê arquivo"| D1
    D1 -->|"12. Bulk insert idempotente"| D2
    D1 -->|"13. Dispara staging_carregado"| B3

    %% 4 -> 5: Consolidação
    B3 -->|"14. Inicia consolidação"| E1
    D2 -.->|"Lê pendentes"| E1
    E1 -->|"15. Auto-cadastra se nova"| E2
    E1 -->|"16. Grava lançamentos finais"| E3

    %% Notificações em Tempo Real
    B3 -.->|"Eventos SSE em tempo real"| A3

    %% ==========================================
    %% PALETA DE CORES MODERNA & HARMONIOSA
    %% ==========================================
    classDef front fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,color:#0369a1;
    classDef ingest fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#92400e;
    classDef ai fill:#ffe4e6,stroke:#e11d48,stroke-width:2px,color:#9f1239;
    classDef staging fill:#f3e8ff,stroke:#9333ea,stroke-width:2px,color:#6b21a8;
    classDef final fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#166534;

    class A1,A2,A3 front;
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
    participant W as ⚡ Workers Assíncronos
    participant AI as 🧠 Google Gemini 2.5
    participant DB as 🗄️ PostgreSQL

    %% 1. Ingestão
    rect rgb(238, 242, 255)
        Note over User, API: 1. Ingestão e Recebimento
        User->>UI: Seleciona arquivos ou pasta inteira
        UI->>API: POST /api/importacao/upload (multipart)
        API->>DB: Registra Lote e Arquivos (RECEPCIONADO)
        API-->>UI: HTTP 202 Accepted (loteId)
        UI->>User: Exibe Painel de Acompanhamento
    end

    %% 2. Processamento IA
    rect rgb(253, 242, 248)
        Note over W, AI: 2. Extração Sequencial com IA
        API-)W: Dispara evento lote_recepcionado
        loop Para cada arquivo do lote
            W->>AI: Envia arquivo + Contexto do Usuário (Contas/Categorias)
            AI-->>W: Retorna transações estruturadas (Zod validado)
            W->>W: Salva consolidado_arquivoId.json em disco
        end
    end

    %% 3. Staging
    rect rgb(243, 232, 255)
        Note over W, DB: 3. Carga em Staging
        W->>DB: Bulk insert em staging_lancamentos_importacao
        W-)UI: Notifica via SSE (arquivos prontos)
    end

    %% 4. Consolidação e Regras de Negócio
    rect rgb(236, 253, 245)
        Note over W, DB: 4. Consolidação de Negócio
        W->>DB: Verifica contas (Auto-cadastra contas novas se inexistentes)
        W->>DB: Verifica duplicidade via hash SHA-256 (Dedupe)
        W->>DB: Aplica regra anti-dupla contagem (faturas -> TRANSFERENCIA_PROPRIA)
        W->>DB: Insere lançamentos definitivos na tabela movimentos
        W-)UI: SSE: Eventos de transações concluídas em tempo real
    end

    UI->>User: ✅ Notifica lote 100% concluído e saldos atualizados
```

---

## 🔄 Detalhamento das 5 Etapas do Pipeline

### 1. Seleção e Envio no Frontend ([`TelaImportacaoIa.tsx`](../web/src/screens/TelaImportacaoIa.tsx))
- **Seleção flexível:** O usuário pode arrastar múltiplos arquivos (`.pdf`, `.csv`, `.ofx`, `.txt`, imagens) ou selecionar uma pasta inteira do computador.
- **Resposta imediata:** O upload responde com código `HTTP 202 Accepted`, liberando a interface instantaneamente.
- **Painel de Acompanhamento:** A tela transiciona para um monitor com barra de progresso e feed de atividades ao vivo via SSE (*Server-Sent Events*).

---

### 2. Ingestão e Armazenamento ([`ImportacaoStorageService`](../src/modules/importacao/importacao-storage.service.ts))
- **Diretório seguro:** Arquivos salvos em pasta física isolada:
  ```
  uploads/yyyy-mm-dd-hh-mm-ss-{usuarioId}/
  ```
- **Sanitização de caminhos:** Bloqueio de *Path Traversal* (rejeição de `../` e paths absolutos).
- **Rastreabilidade:** Criação de registros de auditoria em `lotes_importacao` e `arquivos_importacao`.

---

### 3. Extração Sequencial por IA ([`ImportacaoIaWorkerService`](../src/modules/importacao/worker/importacao-ia-worker.service.ts))
- **Execução 1 a 1:** Os arquivos são processados sequencialmente para proteger quotas e evitar *rate limits*.
- **Injeção de contexto:** O worker envia ao Gemini o histórico de contas bancárias e a árvore POF do usuário logado.
- **Extração rica:** O modelo ([`GeminiIaExtratorClient`](../src/modules/importacao/worker/ia-extrator.client.ts)) extrai data, valor, natureza, conta sugerida, categoria POF e parcelamentos.
- **Validação estrita:** Schema Zod ([`arquivoConsolidadoIaSchema`](../src/modules/importacao/worker/ia-extrator.schema.ts)) garante tipagem precisa antes da gravação do JSON intermediário.

---

### 4. Carga em Staging ([`ImportacaoStagingWorkerService`](../src/modules/importacao/worker/importacao-staging-worker.service.ts))
- **Área de quarentena:** As transações extraídas do JSON são gravadas na tabela temporária `staging_lancamentos_importacao`.
- **Idempotência:** Garante que falhas parciais possam ser reexecutadas sem corromper os dados do usuário.

---

### 5. Consolidação e Gravação Oficial ([`ImportacaoConsolidacaoWorkerService`](../src/modules/importacao/worker/importacao-consolidacao-worker.service.ts))
- **Auto-Cadastro de Contas:** Se o documento trouxer uma conta nova (ex: "Nubank Cartão"), o sistema provisiona a conta automaticamente no banco sem travar a importação.
- **Anti-Dupla Contagem:** Pagamentos de faturas de cartão são convertidos para `TRANSFERENCIA_PROPRIA`, impedindo somas duplicadas nas despesas.
- **Deduplicação Determinística:** Hash `SHA-256(contaId + data + valor + descricao)` descarta automaticamente lançamentos já existentes.
- **Gravação Definitiva:** Grava os registros em `movimentos` (status `CONCILIADO`) e atualiza o lote para `CONCLUIDO`.

---

## 🔒 Matriz de Segurança e Integridade

| Pilar | Mecanismo de Proteção |
|---|---|
| **Multi-Tenancy** | Todas as operações são isoladas estritamente pelo `usuarioId` autenticado. |
| **Sanitização** | Bloqueio rigoroso contra ataques de navegação em diretórios (*Path Traversal*). |
| **Anti-Duplicação** | Hash SHA-256 impede reimportação acidental de extratos repetidos. |
| **Anti-Dupla Contagem** | Regra inteligente para pagamentos de cartão de crédito. |
| **Estabilidade de Quota** | Fila sequencial de IA impedindo estouro de concorrência. |

---

## 🛠️ Endpoints REST da Importação

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/api/importacao/upload` | Envia arquivos ou pastas para início do pipeline (HTTP 202). |
| `GET` | `/api/importacao/lotes` | Lista os lotes de importação do usuário. |
| `GET` | `/api/importacao/lotes/:id` | Status detalhado de arquivos e progresso do lote. |
| `GET` | `/api/importacao/lotes/:id/staging` | Consulta transações em staging para auditoria. |
| `GET` | `/api/importacao/stream-eventos` | Streaming Server-Sent Events (SSE) com atualizações em tempo real. |
| `POST` | `/api/importacao/lotes/:id/processar-ia` | Disparo manual/contingência da etapa de IA. |
| `POST` | `/api/importacao/lotes/:id/carregar-staging` | Disparo manual da etapa de staging. |
| `POST` | `/api/importacao/lotes/:id/consolidar` | Disparo manual da etapa de consolidação final. |
