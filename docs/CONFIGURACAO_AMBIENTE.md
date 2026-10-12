# 🛠️ Configuração de Ambiente de Desenvolvimento

Este guia descreve os pré-requisitos e o passo a passo para configurar e rodar o projeto **Evolvi** localmente na sua máquina de desenvolvimento.

---

## 1. Pré-requisitos do Sistema

Certifique-se de ter instalado em sua estação de trabalho:

- **Node.js**: Versão 20+ LTS (recomendado v22 ou superior).
- **NPM**: Versão 10+ (ou gerenciador compatível).
- **Docker & Docker Compose**: Versão v24+ com plugin compose v2+, para executar a instância local do PostgreSQL.
- **Git**: Para controle de versão.

Verifique as versões com:
```bash
node -v
npm -v
docker -v
docker compose version
```

---

## 2. Passo a Passo de Instalação

### 2.1 Clonar o Repositório
```bash
git clone https://github.com/mhjmhj2002/evolvi.git
cd evolvi
```

### 2.2 Instalar as Dependências
Execute o comando de instalação para baixar todas as dependências de desenvolvimento e produção:
```bash
npm install
```

### 2.3 Configurar Variáveis de Ambiente
Copie o arquivo de exemplo `.env.example` para `.env`:
```bash
cp .env.example .env
```

Edite o arquivo `.env` se precisar alterar portas ou credenciais. O conteúdo padrão para desenvolvimento local é:
```ini
# Ambiente
NODE_ENV=development
PORT=3000
HOST=0.0.0.0

# Banco de Dados PostgreSQL
DATABASE_URL=postgresql://evolvi:evolvi_secret@localhost:5432/evolvi_db?schema=public

# Autenticação & Segurança
JWT_SECRET=super_secret_jwt_key_troque_em_producao_123456789
JWT_EXPIRES_IN=7d

# CORS
CORS_ORIGIN=http://localhost:5173
```

> **Atenção:** As variáveis de ambiente são estritamente validadas via Zod na inicialização da aplicação ([`src/config/env.ts`](file:///home/mhj/git/evolvi/src/config/env.ts)). O servidor encerra a inicialização se alguma variável obrigatória estiver ausente ou inválida.

---

## 3. Inicializar o Banco de Dados Local (PostgreSQL)

Utilize o Docker Compose fornecido no projeto para subir o contêiner do PostgreSQL 15:

```bash
# Iniciar o banco de dados em segundo plano
docker compose up -d postgres
```

Para verificar se o contêiner está saudável e rodando:
```bash
docker compose ps
```

Para inspecionar os logs do banco de dados:
```bash
docker compose logs -f postgres
```

---

---

## 4. Inicializar Migrations e Seeds do Banco de Dados

Com o PostgreSQL ativo via Docker, execute as migrações do Prisma e a carga das categorias POF:

```bash
# Executa as migrations do Prisma
npm run prisma:migrate

# Executa o seed de dados (21 categorias POF e 74 subcategorias)
npm run prisma:seed
```

---

## 5. Executando os Servidores de Desenvolvimento

O projeto é dividido em **Backend (Fastify + Prisma)** e **Frontend Web (React + Vite Mobile-First)**:

### 5.1 Backend API
```bash
npm run dev
```
- **URL Base:** `http://localhost:3000`
- **Healthcheck:** `http://localhost:3000/health`

### 5.2 Frontend Web Mobile-First
```bash
npm run dev:web
```
- **URL da Aplicação Web:** `http://localhost:5173`
- *O Vite já inclui proxy configurado para redirecionar chamadas `/api` para `http://localhost:3000`.*

---

## 6. Scripts Disponíveis

| Comando | Descrição |
|---|---|
| `npm run dev` | Inicia a API backend em modo de desenvolvimento com hot-reload (`tsx watch`) na porta 3000 |
| `npm run dev:web` | Inicia o servidor de desenvolvimento do frontend React via **Vite** na porta 5173 |
| `npm run build` | Compila o backend TypeScript para JavaScript na pasta `dist/` |
| `npm run build:web` | Valida tipagem do frontend (`tsc -p tsconfig.web.json`) e gera o bundle de produção via Vite em `dist/web/` |
| `npm start` | Executa o backend compilado em produção (`dist/server.js`) |
| `npm test` | Executa os testes automatizados com o **Vitest** |
| `npm run test:watch` | Executa os testes em modo interativo/observador contínuo |
| `npm run prisma:migrate` | Aplica as migrations do Prisma no PostgreSQL |
| `npm run prisma:seed` | Executa a carga das 21 categorias consolidadas da POF |
| `npm run prisma:studio` | Abre a interface visual do Prisma Studio no navegador |
| `npm run lint` | Valida as regras de código com o **ESLint** |
| `npm run lint:fix` | Corrige problemas mecânicos de lint automaticamente |
| `npm run format` | Formata o código fonte com o **Prettier** |

---

## 6. Verificação de Saúde e Testes

Para garantir que tudo está operando corretamente:

1. **Rodar os testes automatizados:**
   ```bash
   npm test
   ```
2. **Checar o linter:**
   ```bash
   npm run lint
   ```
3. **Verificar a rota de healthcheck:**
   ```bash
   curl http://localhost:3000/health
   ```
   Resposta esperada:
   ```json
   {"status":"ok","timestamp":"...","environment":"development"}
   ```
