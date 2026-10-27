#!/usr/bin/env bash
# ==============================================================================
# Evolvi — Limpeza de Histórico de Lançamentos e Importações do Usuário
# Localização: docs/automacao/limpar_historico_importacao.sh
# ==============================================================================

# Cores e Formatação
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${PROJECT_ROOT}" || exit 1

# Versão mínima do Node.js exigida (tsx e o Prisma Client não funcionam no Node 12)
NODE_MIN_MAJOR=20

# Garante que a janela do terminal permaneça aberta em TODOS os caminhos (erro ou sucesso)
pause_exit() {
  local exit_code="${1:-0}"
  echo ""
  echo -e "${YELLOW}Pressione qualquer tecla ou ENTER para fechar este terminal...${NC}"
  read -r -n 1 -s -r _junk 2>/dev/null || read -r _junk 2>/dev/null
  exit "${exit_code}"
}

# Retorna a versão major de um binário node (0 quando não executável/indisponível)
node_major() {
  local bin="$1" major
  major="$("${bin}" -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
  case "${major}" in
    '' | *[!0-9]*) echo 0 ;;
    *) echo "${major}" ;;
  esac
}

# Resolve um Node.js compatível. Essencial para launchers gráficos (.desktop):
# eles não herdam o PATH do shell, e `npx` cairia no Node 12 do sistema — que
# falha ao carregar o bundle ESM do tsx (SyntaxError: Unexpected token '.').
resolver_node() {
  local candidato

  # 1. nvm do usuário (instalação padrão)
  export NVM_DIR="${NVM_DIR:-${HOME}/.nvm}"
  if [ -s "${NVM_DIR}/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "${NVM_DIR}/nvm.sh" >/dev/null 2>&1
    nvm use --silent default >/dev/null 2>&1
  fi
  candidato="$(command -v node 2>/dev/null)"
  if [ -n "${candidato}" ] && [ "$(node_major "${candidato}")" -ge "${NODE_MIN_MAJOR}" ]; then
    printf '%s' "${candidato}"
    return 0
  fi

  # 2. Versões instaladas pelo nvm (qualquer uma compatível)
  for candidato in "${HOME}"/.nvm/versions/node/*/bin/node; do
    [ -x "${candidato}" ] || continue
    if [ "$(node_major "${candidato}")" -ge "${NODE_MIN_MAJOR}" ]; then
      printf '%s' "${candidato}"
      return 0
    fi
  done

  # 3. Outros locais usuais
  for candidato in /usr/local/bin/node /usr/bin/node /opt/node/bin/node; do
    [ -x "${candidato}" ] || continue
    if [ "$(node_major "${candidato}")" -ge "${NODE_MIN_MAJOR}" ]; then
      printf '%s' "${candidato}"
      return 0
    fi
  done

  return 1
}

echo -e "${BLUE}${BOLD}==============================================================================${NC}"
echo -e "${BLUE}${BOLD}      EVOLVI — LIMPEZA DE HISTÓRICO DE LANÇAMENTOS E IMPORTAÇÕES               ${NC}"
echo -e "${BLUE}${BOLD}==============================================================================${NC}"
echo -e "Este comando limpará todos os lançamentos financeiros, lotes, arquivos de"
echo -e "importação, staging, histórico, alertas e tentativas de extração por arquivo"
echo -e "(tabela tentativas_arquivo_importacao) do usuário para reimportação limpa."
echo -e "${GREEN}${BOLD}As configurações e credenciais de IA cadastradas serão estritamente preservadas.${NC}"
echo -e "${GREEN}${BOLD}O histórico de gastos de IA (tabela uso_ia_logs) também será preservado:${NC}"
echo -e "${GREEN}${BOLD}gasto de IA não é dado de importação e serve de base para auditoria.${NC}"
echo ""

# Pré-requisito: dependências instaladas (tsx + Prisma Client)
if [ ! -d "${PROJECT_ROOT}/node_modules" ]; then
  echo -e "${RED}${BOLD}✖ node_modules não encontrado em ${PROJECT_ROOT}.${NC}"
  echo -e "${YELLOW}Execute 'npm install' na raiz do projeto e tente novamente.${NC}"
  pause_exit 1
fi

TSX_CLI="${PROJECT_ROOT}/node_modules/tsx/dist/cli.mjs"
if [ ! -f "${TSX_CLI}" ]; then
  echo -e "${RED}${BOLD}✖ O runner 'tsx' não foi encontrado em node_modules/tsx.${NC}"
  echo -e "${YELLOW}Execute 'npm install' na raiz do projeto e tente novamente.${NC}"
  pause_exit 1
fi

# Pré-requisito: Node.js compatível
NODE_BIN="$(resolver_node)" || NODE_BIN=""
if [ -z "${NODE_BIN}" ]; then
  echo -e "${RED}${BOLD}✖ Node.js ${NODE_MIN_MAJOR}+ não encontrado.${NC}"
  echo -e "${YELLOW}Node atual: $(command -v node 2>/dev/null || echo 'não instalado') ($(node -v 2>/dev/null || echo 'sem versão'))${NC}"
  echo -e "${YELLOW}Instale via nvm (https://github.com/nvm-sh/nvm) e rode 'nvm alias default 24'.${NC}"
  pause_exit 1
fi
# Garante que processos filhos (Prisma, tsx) usem o mesmo Node.js compatível
export PATH="$(dirname "${NODE_BIN}"):${PATH}"
echo -e "${CYAN}Node.js em uso: ${NODE_BIN} ($("${NODE_BIN}" -v 2>/dev/null))${NC}"
echo ""

EMAIL_ALVO="${1:-mhjmhj2002@gmail.com}"
export EMAIL_ALVO

echo -e "${YELLOW}Deseja realmente limpar o histórico do usuário ${BOLD}${EMAIL_ALVO}${NC}${YELLOW}? (s/N): ${NC}"
read -r CONFIRMACAO
if [[ ! "${CONFIRMACAO}" =~ ^[sSyY]$ ]]; then
  echo -e "${RED}Operação cancelada pelo usuário.${NC}"
  pause_exit 0
fi

echo -e "${CYAN}Executando script de limpeza segura...${NC}"
"${NODE_BIN}" "${TSX_CLI}" "${SCRIPT_DIR}/limpar_historico_importacao.ts"
EXIT_CODE=$?

echo ""
if [ "${EXIT_CODE}" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}✔ Processo de limpeza finalizado com sucesso!${NC}"
  echo -e "${GREEN}✔ Os arquivos físicos de upload do usuário ${BOLD}${EMAIL_ALVO}${NC}${GREEN} foram removidos do disco.${NC}"
else
  echo -e "${RED}${BOLD}✖ Ocorreu um erro durante a execução da limpeza (código ${EXIT_CODE}).${NC}"
fi

pause_exit "${EXIT_CODE}"
