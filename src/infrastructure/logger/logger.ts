/**
 * Formata uma data no padrão estrito requerido: yyyy-mm-dd-hh:mm:ss.sss
 * Exemplo: 2026-10-16-20:30:15.123
 */
export function formatLogTimestamp(date = new Date()): string {
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

export interface LoggerOptions {
  app?: string;
}

/**
 * Instala interceptadores em console (log, info, warn, error, debug)
 * prefixando cada saída com "[yyyy-mm-dd-hh:mm:ss.sss] [app]".
 */
export function setupConsoleLogger(appName = 'evolvi-backend') {
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;

  for (const method of methods) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      const prefix = `[${formatLogTimestamp()}] [${appName}]`;
      if (typeof args[0] === 'string') {
        original(`${prefix} ${args[0]}`, ...args.slice(1));
      } else {
        original(prefix, ...args);
      }
    };
  }
}
