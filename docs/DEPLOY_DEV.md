# 🚀 Guia de Deploy em Ambiente de Desenvolvimento (Dev)

Este documento orienta o processo de deploy, publicação e execução contínua da aplicação **Evolvi** em ambientes de desenvolvimento (servidor de staging/dev ou ambiente compartilhado de equipe).

---

## 1. Visão Geral da Arquitetura em Desenvolvimento

Em ambiente de desenvolvimento compartilhado ou servidor de homologação/staging, a arquitetura é composta por:

1. **Camada de Banco de Dados:** PostgreSQL 15+ com extensão/schemas gerenciados.
2. **Camada de Aplicação:** Node.js (v20+ LTS) executando o bundle compilado (`dist/server.js`) ou container Docker.
3. **Gerenciador de Processos / Orquestrador:** PM2, Docker Compose ou serviço systemd.
4. **Proxy Reverso (Opcional para HTTPS/SSL):** Nginx ou Traefik encaminhando requisições para a porta interna da aplicação (ex: 3000).

---

## 2. Estratégia de Deploy via Docker Compose (Recomendada)

### 2.1 Adicionar Serviço da Aplicação no `docker-compose.yml`

Para ambientes integrados com Docker, você pode incluir o serviço do backend junto ao banco. Exemplo de configuração para o ambiente de dev:

```yaml
services:
  postgres:
    image: postgres:15-alpine
    container_name: evolvi_postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: evolvi
      POSTGRES_PASSWORD: ${DB_PASSWORD:-evolvi_secret}
      POSTGRES_DB: evolvi_db
    ports:
      - "5432:5432"
    volumes:
      - evolvi_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U evolvi -d evolvi_db"]
      interval: 5s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: .
      dockerfile: Dockerfile.dev
    container_name: evolvi_backend
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "${PORT:-3000}:3000"
    env_file:
      - .env
    environment:
      NODE_ENV: development
      DATABASE_URL: postgresql://evolvi:${DB_PASSWORD:-evolvi_secret}@postgres:5432/evolvi_db?schema=public

volumes:
  evolvi_pgdata:
    driver: local
```

### 2.2 Dockerfile para Desenvolvimento (`Dockerfile.dev`)

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copia manifestos de dependência
COPY package*.json ./

# Instala todas as dependências (incluindo devDependencies)
RUN npm install

# Copia código fonte
COPY . .

# Compila o projeto TypeScript
RUN npm run build

EXPOSE 3000

# Executa o servidor compilado
CMD ["npm", "start"]
```

### 2.3 Executando o Deploy via Docker
```bash
# 1. Puxar alterações mais recentes da branch de dev
git pull origin develop

# 2. Reconstruir imagens e iniciar contêineres em background
docker compose up -d --build

# 3. Verificar o status dos serviços
docker compose ps

# 4. Acompanhar os logs
docker compose logs -f backend
```

---

## 3. Estratégia de Deploy Direto na Máquina (via PM2)

Caso o servidor de desenvolvimento execute Node.js nativo diretamente no host:

### 3.1 Instalar o PM2 Globalmente
```bash
npm install -g pm2
```

### 3.2 Passo a Passo do Script de Deploy
Execute o seguinte pipeline de publicação:

```bash
# 1. Atualizar o repositório
git fetch origin
git checkout develop
git pull origin develop

# 2. Instalar dependências atualizadas
npm install

# 3. Rodar as migrações do banco de dados (se houver novas)
npm run prisma:migrate

# 4. Rodar os testes de garantia de qualidade (CI local)
npm test

# 5. Validar tipos e compilar os fontes TypeScript (Backend e Frontend)
npm run build
npm run build:web

# 6. Iniciar ou reiniciar a instância no PM2
pm2 restart evolvi-dev || pm2 start dist/server.js --name "evolvi-dev" --env .env

# 7. Salvar lista de processos para autostart do sistema
pm2 save
```

### 3.3 Monitoramento com PM2
```bash
# Ver status do processo
pm2 status

# Ver logs em tempo real
pm2 logs evolvi-dev

# Monitorar uso de CPU e memória
pm2 monit
```

---

## 4. Validação Pós-Deploy (Smoke Tests)

Imediatamente após a conclusão do deploy, execute os seguintes testes rápidos de fumaça:

1. **Healthcheck da Aplicação:**
   ```bash
   curl -i http://localhost:3000/health
   ```
   *Critério de Sucesso:* HTTP 200 com payload JSON `{"status": "ok", ...}`.

2. **Validação de Logs:**
   Garanta que não existam erros de conexão com banco de dados ou exceções não capturadas no log da aplicação:
   ```bash
   docker compose logs backend --tail 50
   # ou
   pm2 logs evolvi-dev --lines 50
   ```

3. **Validação de Conexão com o Banco de Dados:**
   Certifique-se de que a string de conexão em `DATABASE_URL` aponta para o host correto da rede de desenvolvimento.

---

## 5. Rollback em Caso de Falha

Se um novo deploy apresentar falhas ou quebrar os testes:

1. **Identificar o commit estável anterior:**
   ```bash
   git log --oneline -n 5
   ```
2. **Reverter para a versão estável:**
   ```bash
   git checkout <HASH_COMMIT_ESTAVEL>
   npm install
   npm run build
   pm2 restart evolvi-dev # ou docker compose up -d --build
   ```
3. **Verificar os logs de erro:**
   Inspecione a falha para correção antes de uma nova tentativa.
