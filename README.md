# Evolvi — Sistema de Gestão Financeira Evolutiva

> **Plataforma Web Mobile-First orientada à jornada de evolução patrimonial:**  
> Da saída do endividamento até a alocação de investimentos de longo prazo.

[![Node.js Version](https://img.shields.io/badge/Node.js-v20%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![Fastify](https://img.shields.io/badge/Fastify-v5-black.svg)](https://fastify.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15%2B-blue.svg)](https://www.postgresql.org/)
[![Tests](https://img.shields.io/badge/Tests-Vitest-orange.svg)](https://vitest.dev/)

---

## 🎯 Sobre o Projeto

O **Evolvi** é um sistema financeiro pessoal desenvolvido para guiar o usuário em etapas evolutivas claras, fundamentado em dados orçamentários empíricos da **POF/IBGE (Pesquisa de Orçamentos Familiares)**:

- **Fase 1 (Ativa): Sair do Endividamento até o Zero a Zero** — Diagnóstico de Baseline com média móvel $N=6$, identificação do Gap Financeiro, matriz de semáforo orçamentário normalizada a 100% e plano de amortização de parcelamentos e despesas fixas.
- **Fase 2: Reserva de Emergência** — Acúmulo de liquidez imediata com meta de 3 a 6 meses do custo de vida essencial.
- **Fase 3: Investimentos e Liberdade Financeira** — Estruturação de carteira diversificada e alocação patrimonial balanceada.

---

## 🏗️ Stack Tecnológica

- **Backend:** Node.js (LTS), TypeScript (strict mode), Fastify (alta performance e baixo overhead).
- **Validação & Segurança:** Zod (validação estrita de schemas e envs), JWT com cookies HttpOnly/SameSite, Argon2/Bcrypt.
- **Banco de Dados:** PostgreSQL 15+ com precisão decimal em centavos (`NUMERIC(12, 2)`).
- **Testes & Qualidade:** Vitest, ESLint 9+ (Flat Config), Prettier.
- **Interface:** Web Responsiva Mobile-First (Fast UX, Bottom Sheets, Bottom Navigation).

---

## ⚡ Começando Rápido

### Pré-requisitos
- Node.js (v20+ LTS)
- Docker & Docker Compose (para o PostgreSQL local)
- Git

### 1. Clonar e Instalar
```bash
git clone https://github.com/mhjmhj2002/evolvi.git
cd evolvi
npm install
```

### 2. Configurar o Ambiente
Copie o arquivo de variáveis de ambiente:
```bash
cp .env.example .env
```

> **Open Finance (Mock vs Real):** Por padrão, o sistema opera em modo de simulação (`OPEN_FINANCE_MODE=mock`), garantindo execução dos testes sem dependência de serviços externos. Para conectar às APIs de produção/agregador, altere para `OPEN_FINANCE_MODE=real` e preencha as credenciais `OPEN_FINANCE_CLIENT_ID`, `OPEN_FINANCE_CLIENT_SECRET` e `OPEN_FINANCE_API_URL`.

### 3. Iniciar o Banco de Dados Local
Suba o PostgreSQL via Docker Compose:
```bash
docker compose up -d postgres
```

### 4. Executar em Modo de Desenvolvimento
```bash
npm run dev
```
O servidor estará rodando em `http://localhost:3000`.  
Acesse o health check para validar a saúde da API:
```bash
curl http://localhost:3000/health
```

---

## 🧪 Scripts NPM

| Comando | Descrição |
|---|---|
| `npm run dev` | Inicia o servidor com recarga automática (`tsx watch`) |
| `npm run build` | Compila o código TypeScript para a pasta `dist/` |
| `npm start` | Executa a versão compilada em produção |
| `npm test` | Executa os testes unitários e de integração com Vitest |
| `npm run test:watch` | Executa os testes no modo observador interativo |
| `npm run lint` | Executa a verificação estática de código com ESLint |
| `npm run lint:fix` | Corrige problemas mecânicos apontados pelo ESLint |
| `npm run format` | Aplica a formatação do Prettier em todo o código fonte |

---

## 📚 Documentação do Projeto

Toda a documentação técnica, arquitetura e guias operacionais estão disponíveis nos links abaixo:

### Guias Operacionais (`/docs`):
- [**Configuração de Ambiente Local**](docs/CONFIGURACAO_AMBIENTE.md) — Passo a passo detalhado de setup e pré-requisitos.
- [**Deploy em Ambiente de Desenvolvimento**](docs/DEPLOY_DEV.md) — Estratégias de deploy com Docker Compose, PM2, smoke tests e rollback.

### Especificações Canônicas (`/.local/documentacao`):
- [**01 — Arquitetura de Software e Tecnologias**](.local/documentacao/01_ARQUITETURA_E_TECNOLOGIAS.md)
- [**02 — Modelagem do Banco PostgreSQL (DDL & ER)**](.local/documentacao/02_MODELAGEM_BANCO_POSTGRES.md)
- [**03 — Especificação da Fase 1: Zero a Zero**](.local/documentacao/03_FASE_1_ZERO_A_ZERO.md)
- [**05 — Design Responsivo, Mobile-First e UI/UX**](.local/documentacao/05_DESIGN_RESPONSIVO_E_UI_UX.md)
- [**06 — Endpoints da API REST e Regras de Negócio**](.local/documentacao/06_API_ENDPOINTS_E_REGRAS.md)
- [**Quadro de Andamento das Demandas**](.local/documentacao/ANDAMENTO_DEMANDAS.md)

---

## 📄 Licença

Este projeto está sob a licença [Apache 2.0](LICENSE).