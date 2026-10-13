# 🚀 Automação de Inicialização do Ambiente Evolvi

Este diretório contém os scripts de automação para subir todo o ecossistema do **Evolvi** com **2 cliques** ou comando direto no terminal.

---

## 📁 Arquivos

- **[`subir_ambiente.sh`](subir_ambiente.sh)**: Script principal Bash executável com permissão `+x`.
- **[`Subir_Ambiente.desktop`](Subir_Ambiente.desktop)**: Atalho para desktop/gerenciador de arquivos Linux (GNOME Files/Nautilus, Dolphin, etc.) configurado com `Terminal=true`.
- **`logs/`**: Diretório onde são salvos os registros de cada inicialização no padrão de nomenclatura `yyyy-mm-dd-hh-mm-ss.txt`.

---

## ⚙️ O que o script faz automaticamente

1. **Geração do Log de Auditoria:**
   - Cria imediatamente um arquivo em `logs/yyyy-mm-dd-hh-mm-ss.txt`.
   - Grava toda a saída (stdout + stderr) limpando caracteres de escape ANSI de cor, mantendo o terminal colorido e legível.

2. **Validação de Ferramentas e Pré-requisitos:**
   - Checa se `node` (v20+), `npm` e `docker` estão instalados no sistema.

3. **Validação das Variáveis de Ambiente:**
   - Se o arquivo `.env` não existir, cria automaticamente a partir de `.env.example`.
   - Valida variáveis obrigatórias (`DATABASE_URL`, `JWT_SECRET`).
   - Valida se `JWT_SECRET` possui ao menos 16 caracteres (regra de segurança do Zod).

4. **Verificação de Serviços Já em Execução (Rebuild & Restart):**
   - Testa se as portas do backend (`PORT` ou padrão `3333`) e do frontend (`5173`) já estão ativas.
   - Caso estejam em execução, encerra os processos em andamento, executa o rebuild das aplicações (`prisma:generate`, `build` e `build:web`) e sobe novamente os serviços atualizados.

5. **Subida do Banco PostgreSQL:**
   - Verifica se o container `evolvi_postgres` está ativo via Docker Compose.
   - Caso não esteja, executa `docker compose up -d postgres` e aguarda o `pg_isready`.

6. **Inicialização dos Servidores:**
   - Inicia o backend (`npm run dev`) e o frontend (`npm run dev:web`).
   - Gerencia sinais de encerramento (`SIGINT` / `Ctrl+C`), matando os processos filhos de forma limpa.

7. **Terminal Persistente (Não fecha sozinho):**
   - Independentemente de terminar com sucesso ou erro, o terminal solicita `Pressione qualquer tecla ou ENTER para fechar este terminal...`, garantindo que o usuário leia os logs e mensagens de erro.

---

## 🖱️ Como Usar em 2 Cliques

### Opção 1: Pelo gerenciador de arquivos (Nautilus / Dolphin)
1. Dê um duplo clique em [`subir_ambiente.sh`](subir_ambiente.sh) ou [`Subir_Ambiente.desktop`](Subir_Ambiente.desktop).
2. Se o sistema perguntar, selecione **"Executar no Terminal"** (ou **"Run in Terminal"**).

### Opção 2: Pela linha de comando
```bash
./docs/automacao/subir_ambiente.sh
```
