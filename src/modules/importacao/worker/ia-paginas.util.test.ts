import { describe, expect, it } from 'vitest';
import { dividirDocumentoEmPaginas, dividirPaginaEmChunks } from './ia-paginas.util.js';

describe('origem e contagem por página dos lançamentos extraídos', () => {
  it('mantém páginas vazias e remove apenas o separador final do extrator PDF', () => {
    expect(dividirDocumentoEmPaginas('página A\f\fpágina C\f', 3)).toEqual([
      { pagina: 1, texto: 'página A' },
      { pagina: 2, texto: '' },
      { pagina: 3, texto: 'página C' },
    ]);
  });

  it('não inventa a página quando os limites textuais não correspondem ao total físico', () => {
    expect(dividirDocumentoEmPaginas('texto sem delimitadores', 4)).toEqual([
      { pagina: null, texto: 'texto sem delimitadores' },
    ]);
  });

  it('mantém a página de origem ao dividir uma página em chunks', () => {
    const chunks = dividirPaginaEmChunks([{ pagina: 2, texto: 'linha 1\nlinha 2\nlinha 3' }], 12);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.pagina === 2)).toBe(true);
    expect(chunks.map((chunk) => chunk.texto).join('')).toBe('linha 1\nlinha 2\nlinha 3');
  });
});
