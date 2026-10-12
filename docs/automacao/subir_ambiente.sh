#!/usr/bin/env bash
# ==============================================================================
# Evolvi — Script de Inicialização Automatizada do Ambiente (2 Cliques)
# Localização: docs/automacao/subir_ambiente.sh
# ==============================================================================

# Cores e Formatação
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Identificar diretório raiz do projeto (2 níveis acima deste script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${PROJECT_ROOT}" || exit 1

# Diretório e nome do arquivo de log formatado: yyyy-mm-dd-hh-mm-ss.txt
LOGS_DIR="${PROJECT_ROOT}/docs/automacao/logs"
mkdir -p "${LOGS_DIR}"
TIMESTAMP=$(date +"%Y-%m-%d-%H-%M-%S")
LOG_FILE="${LOGS_DIR}/${TIMESTAMP}.txt"

# Função para garantir que a janela do terminal permaneça aberta sob qualquer condição
pause_exit() {
  local exit_code=$1
  echo ""
  if [ "${exit_code}" -eq 0 ]; then
    echo -e "${GREEN}${BOLD}✔ Ambiente finalizado ou interrompido normalmente.${NC}"
  else
    echo -e "${RED}${BOLD}✖ Ocorreu um problema durante a execução (Código de saída: ${exit_code}).${NC}"
  fi
  echo -e "${CYAN}Log salvo em: ${LOG_FILE}${NC}"
  echo ""
  echo -e "${YELLOW}Pressione qualquer tecla ou ENTER para fechar este terminal...${NC}"
  read -r -n 1 -s -r _junk 2>/dev/null || read -r _junk 2>/dev/null
  exit "${exit_code}"
}

# Redirecionar stdout e stderr para tela e arquivo de log (removendo códigos ANSI no arquivo de log)
exec > >(tee >(sed -u -r "s/\x1B\[[0-9;]*[a-zA-Z]//g" >> "${LOG_FILE}")) 2>&1

echo "=============================================================================="
echo "          EVOLVI — INICIALIZADOR AUTOMÁTICO DE AMBIENTE DEV                   "
echo "=============================================================================="
echo "Data/Hora de Inicialização : $(date '+%d/%m/%Y %H:%M:%S')"
echo "Diretório do Projeto       : ${PROJECT_ROOT}"
echo "Arquivo de Registro (Log)  : ${LOG_FILE}"
echo "=============================================================================="
echo ""

# Tentar carregar NVM ou caminhos conhecidos do Node se o ambiente não for uma shell interativa
if [ -s "${HOME}/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  export NVM_DIR="${HOME}/.nvm"
  \. "${NVM_DIR}/nvm.sh" 2>/dev/null
  # Usar a versão padrão do nvm ou a versão ativa mais recente
  nvm use default >/dev/null 2>&1 || nvm use stable >/dev/null 2>&1 || true
elif [ -s "${HOME}/.bashrc" ]; then
  # shellcheck disable=SC1090
  source "${HOME}/.bashrc" >/dev/null 2>&1 || true
fi

# ------------------------------------------------------------------------------
# 1. Validação de Pré-requisitos Básicos do Sistema
# ------------------------------------------------------------------------------
echo -e "${BLUE}[1/5] Verificando ferramentas e pré-requisitos do sistema...${NC}"

if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}ERRO: Node.js não foi encontrado no PATH.${NC}"
  echo "Por favor, instale o Node.js v20+ LTS antes de continuar."
  pause_exit 1
fi

NODE_VER_RAW=$(node -v | tr -d 'v')
NODE_MAJOR=$(echo "${NODE_VER_RAW}" | cut -d'.' -f1)

if [ -z "${NODE_MAJOR}" ] || [ "${NODE_MAJOR}" -lt 20 ]; then
  echo -e "${RED}ERRO: Versão do Node.js incompatível: v${NODE_VER_RAW}.${NC}"
  echo -e "O projeto Evolvi (Vite e TSX) requer Node.js v20+ LTS."
  if [ -d "${HOME}/.nvm/versions/node" ]; then
    echo -e "${YELLOW}Dica: Versões mais recentes foram detectadas em ~/.nvm. Execute 'nvm alias default 24' ou utilize 'nvm use'.${NC}"
  fi
  pause_exit 1
fi
echo -e "  ✔ Node.js detectado: $(node -v)"

if ! command -v npm >/dev/null 2>&1; then
  echo -e "${RED}ERRO: NPM não foi encontrado no PATH.${NC}"
  pause_exit 1
fi
echo -e "  ✔ NPM detectado: v$(npm -v)"

if ! command -v docker >/dev/null 2>&1; then
  echo -e "${RED}ERRO: Docker não foi encontrado no PATH.${NC}"
  pause_exit 1
fi
echo -e "  ✔ Docker detectado: $(docker --version)"

# ------------------------------------------------------------------------------
# 2. Validação do Arquivo e Variáveis de Ambiente (.env)
# ------------------------------------------------------------------------------
echo ""
echo -e "${BLUE}[2/5] Validando arquivo de configuração e variáveis de ambiente...${NC}"

if [ ! -f "${PROJECT_ROOT}/.env" ]; then
  echo -e "${YELLOW}Aviso: Arquivo .env não encontrado no diretório raiz.${NC}"
  if [ -f "${PROJECT_ROOT}/.env.example" ]; then
    echo -e "Copiando .env.example para .env..."
    cp "${PROJECT_ROOT}/.env.example" "${PROJECT_ROOT}/.env"
    echo -e "${GREEN}✔ Arquivo .env criado com sucesso a partir de .env.example.${NC}"
  else
    echo -e "${RED}ERRO: Nem .env nem .env.example foram encontrados!${NC}"
    pause_exit 1
  fi
fi

# Carregar variáveis do .env ignorando comentários
set -a
# shellcheck disable=SC1091
source "${PROJECT_ROOT}/.env"
set +a

# Lista de variáveis essenciais para validação estrita
VARS_FALTANDO=()

[ -z "${DATABASE_URL:-}" ] && VARS_FALTANDO+=("DATABASE_URL")
[ -z "${JWT_SECRET:-}" ] && VARS_FALTANDO+=("JWT_SECRET")

if [ ${#VARS_FALTANDO[@]} -ne 0 ]; then
  echo -e "${RED}ERRO: As seguintes variáveis obrigatórias estão ausentes no .env:${NC}"
  for v in "${VARS_FALTANDO[@]}"; do
    echo "  - $v"
  done
  pause_exit 1
fi

# Validação do tamanho mínimo de segurança do JWT_SECRET (mínimo 16 caracteres conforme Zod)
if [ ${#JWT_SECRET} -lt 16 ]; then
  echo -e "${RED}ERRO: A variável JWT_SECRET deve ter ao menos 16 caracteres (possui ${#JWT_SECRET}).${NC}"
  pause_exit 1
fi

BACKEND_PORT="${PORT:-3333}"
FRONTEND_PORT="5173"

echo -e "  ✔ Variáveis de ambiente validadas com sucesso."
echo -e "  ✔ Porta configurada Backend : ${BACKEND_PORT}"
echo -e "  ✔ Porta configurada Frontend: ${FRONTEND_PORT}"

# ------------------------------------------------------------------------------
# 3. Verificação se o Ambiente Já Está em Execução
# ------------------------------------------------------------------------------
echo ""
echo -e "${BLUE}[3/5] Verificando se serviços do ambiente já estão em execução...${NC}"

PORT_IN_USE() {
  local p=$1
  if command -v ss >/dev/null 2>&1; then
    ss -tulpn 2>/dev/null | grep -q ":${p} "
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"${p}" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v netstat >/dev/null 2>&1; then
    netstat -tuln 2>/dev/null | grep -q ":${p} "
  else
    # Fallback via curl simples
    curl -s --connect-timeout 1 "http://localhost:${p}" >/dev/null 2>&1
  fi
}

JA_RODANDO_BACKEND=false
JA_RODANDO_FRONTEND=false

if PORT_IN_USE "${BACKEND_PORT}"; then
  # Verificar se a porta ocupada responde pelo healthcheck do Evolvi
  HEALTH_CHECK_RESULT=$(curl -s --connect-timeout 2 "http://localhost:${BACKEND_PORT}/health" 2>/dev/null || echo "")
  if echo "${HEALTH_CHECK_RESULT}" | grep -q '"status":"ok"'; then
    echo -e "${YELLOW}  ⚠ O backend do Evolvi já está em execução na porta ${BACKEND_PORT}!${NC}"
    JA_RODANDO_BACKEND=true
  else
    echo -e "${YELLOW}  ⚠ Atenção: A porta ${BACKEND_PORT} já está em uso por outro processo.${NC}"
    echo -e "    Resposta da porta: ${HEALTH_CHECK_RESULT:0:120}..."
  fi
else
  echo -e "  ✔ Porta do Backend (${BACKEND_PORT}) livre."
fi

if PORT_IN_USE "${FRONTEND_PORT}"; then
  echo -e "${YELLOW}  ⚠ O frontend (Vite) já está em execução na porta ${FRONTEND_PORT}!${NC}"
  JA_RODANDO_FRONTEND=true
else
  echo -e "  ✔ Porta do Frontend (${FRONTEND_PORT}) livre."
fi

# Se ambos já estiverem respondendo
if [ "${JA_RODANDO_BACKEND}" = true ] && [ "${JA_RODANDO_FRONTEND}" = true ]; then
  echo ""
  echo -e "${GREEN}${BOLD}==============================================================================${NC}"
  echo -e "${GREEN}${BOLD}  O AMBIENTE COMPLETO JÁ ESTÁ EM EXECUÇÃO E PRONTO PARA USO!                 ${NC}"
  echo -e "${GREEN}${BOLD}==============================================================================${NC}"
  echo -e "• Frontend Web (Mobile-First) : ${CYAN}http://localhost:${FRONTEND_PORT}${NC}"
  echo -e "• Backend API (Fastify)       : ${CYAN}http://localhost:${BACKEND_PORT}${NC}"
  echo -e "• Healthcheck                 : ${CYAN}http://localhost:${BACKEND_PORT}/health${NC}"
  echo ""
  pause_exit 0
fi

# ------------------------------------------------------------------------------
# 4. Inicialização da Infraestrutura do Banco (PostgreSQL via Docker)
# ------------------------------------------------------------------------------
echo ""
echo -e "${BLUE}[4/5] Garantindo banco de dados PostgreSQL ativo via Docker Compose...${NC}"

if docker compose ps | grep -q "evolvi_postgres.*Up"; then
  echo -e "  ✔ Contêiner PostgreSQL (evolvi_postgres) já está rodando."
else
  echo -e "  Subindo contêiner PostgreSQL..."
  if ! docker compose up -d postgres; then
    echo -e "${RED}ERRO: Falha ao iniciar contêiner do banco com docker compose up -d postgres.${NC}"
    pause_exit 1
  fi
  echo -e "  Aguardando banco de dados aceitar conexões..."
  MAX_TENTATIVAS=20
  TENTATIVA=1
  READY=false
  while [ $TENTATIVA -le $MAX_TENTATIVAS ]; do
    if docker compose exec -T postgres pg_isready -U evolvi -d evolvi_db >/dev/null 2>&1; then
      READY=true
      break
    fi
    sleep 1
    TENTATIVA=$((TENTATIVA + 1))
  done

  if [ "$READY" = true ]; then
    echo -e "${GREEN}  ✔ PostgreSQL pronto para receber conexões.${NC}"
  else
    echo -e "${YELLOW}  ⚠ PostgreSQL pode ainda estar inicializando. Prosseguindo com cautela.${NC}"
  fi
fi

# Verificar dependências do node_modules
if [ ! -d "${PROJECT_ROOT}/node_modules" ]; then
  echo ""
  echo -e "${YELLOW}node_modules não encontrado. Executando npm install...${NC}"
  if ! npm install; then
    echo -e "${RED}ERRO: Falha ao instalar dependências com npm install.${NC}"
    pause_exit 1
  fi
fi

# ------------------------------------------------------------------------------
# 5. Execução dos Servidores Backend e Frontend
# ------------------------------------------------------------------------------
echo ""
echo -e "${BLUE}[5/5] Subindo os servidores de desenvolvimento...${NC}"

# Função para encerrar processos filhos capturando sinais SIGINT/SIGTERM
BACKEND_PID=""
FRONTEND_PID=""

cleanup_processes() {
  echo ""
  echo -e "${YELLOW}Interrupção detectada. Encerrando processos de desenvolvimento...${NC}"
  if [ -n "${BACKEND_PID}" ] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    kill "${BACKEND_PID}" 2>/dev/null
  fi
  if [ -n "${FRONTEND_PID}" ] && kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    kill "${FRONTEND_PID}" 2>/dev/null
  fi
  wait 2>/dev/null
  pause_exit 0
}

trap cleanup_processes SIGINT SIGTERM

if [ "${JA_RODANDO_BACKEND}" = false ]; then
  echo -e "Iniciando Backend API Fastify (npm run dev)..."
  npm run dev &
  BACKEND_PID=$!
  echo -e "  ✔ Backend iniciado (PID: ${BACKEND_PID})"
else
  echo -e "  ✔ Backend já estava rodando, mantendo o processo existente."
fi

if [ "${JA_RODANDO_FRONTEND}" = false ]; then
  echo -e "Iniciando Frontend React Vite (npm run dev:web)..."
  npm run dev:web &
  FRONTEND_PID=$!
  echo -e "  ✔ Frontend iniciado (PID: ${FRONTEND_PID})"
else
  echo -e "  ✔ Frontend já estava rodando, mantendo o processo existente."
fi

echo ""
echo -e "${GREEN}${BOLD}==============================================================================${NC}"
echo -e "${GREEN}${BOLD}        🚀 AMBIENTE EVOLVI INICIALIZADO COM SUCESSO!                          ${NC}"
echo -e "${GREEN}${BOLD}==============================================================================${NC}"
echo -e "• Frontend Web (Mobile-First) : ${CYAN}${BOLD}http://localhost:${FRONTEND_PORT}${NC}"
echo -e "• Backend API (Fastify)       : ${CYAN}${BOLD}http://localhost:${BACKEND_PORT}${NC}"
echo -e "• Healthcheck                 : ${CYAN}${BOLD}http://localhost:${BACKEND_PORT}/health${NC}"
echo -e "• Arquivo de Log desta Sessão : ${CYAN}${LOG_FILE}${NC}"
echo ""
echo -e "${YELLOW}Para encerrar o ambiente, pressione Ctrl+C neste terminal.${NC}"
echo "=============================================================================="
echo ""

# Aguardar os processos em execução
if [ -n "${BACKEND_PID}" ] && [ -n "${FRONTEND_PID}" ]; then
  wait -n "${BACKEND_PID}" "${FRONTEND_PID}" 2>/dev/null || wait
elif [ -n "${BACKEND_PID}" ]; then
  wait "${BACKEND_PID}" 2>/dev/null
elif [ -n "${FRONTEND_PID}" ]; then
  wait "${FRONTEND_PID}" 2>/dev/null
else
  echo -e "${GREEN}Todos os serviços já estavam rodando em segundo plano.${NC}"
fi

pause_exit 0
