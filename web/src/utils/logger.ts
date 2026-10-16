/**
 * Utilitário de formatação de logs para a aplicação Web (Frontend)
 * Formato padrão: [yyyy-mm-dd-hh:mm:ss.sss] [app] mensagem
 */
export function formatWebLogTimestamp(date = new Date()): string {
  const pad = (n: number, size = 2) => String(n).padStart(size, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  const sss = pad(date.getMilliseconds(), 3);

  return `${yyyy}-${mm}-${dd}-${hh}:${min}:${ss}.${sss}`;
}

export function setupWebLogger(appName = 'evolvi-web') {
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;

  for (const method of methods) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      const prefix = `[${formatWebLogTimestamp()}] [${appName}]`;
      if (typeof args[0] === 'string') {
        original(`${prefix} ${args[0]}`, ...args.slice(1));
      } else {
        original(prefix, ...args);
      }
    };
  }
}
