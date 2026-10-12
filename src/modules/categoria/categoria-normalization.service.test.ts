import { describe, it, expect } from 'vitest';
import { normalizarCestaCategorias } from './categoria-normalization.service.js';

describe('Categoria Normalization Service', () => {
  it('deve normalizar uma lista de categorias fechando exatamente em 100.00%', () => {
    const mockCategorias = [
      { id: '1', nome: 'Moradia', pesoBrutoReferencia: 0.2448 },
      { id: '2', nome: 'Transporte', pesoBrutoReferencia: 0.0836 },
      { id: '3', nome: 'Alimentação', pesoBrutoReferencia: 0.2133 },
      { id: '4', nome: 'Educação', pesoBrutoReferencia: 0.1182 },
      { id: '5', nome: 'Viagem', pesoBrutoReferencia: 0.1289 },
      { id: '6', nome: 'Pets', pesoBrutoReferencia: 0.0329 },
      { id: '7', nome: 'Saúde', pesoBrutoReferencia: 0.0360 },
      { id: '8', nome: 'Serviços digitais', pesoBrutoReferencia: 0.0167 },
      { id: '9', nome: 'Vestuário', pesoBrutoReferencia: 0.0177 },
      { id: '10', nome: 'Impostos', pesoBrutoReferencia: 0.0134 },
      { id: '11', nome: 'Telecomunicações', pesoBrutoReferencia: 0.0129 },
      { id: '12', nome: 'Cuidados pessoais', pesoBrutoReferencia: 0.0126 },
      { id: '13', nome: 'Seguros', pesoBrutoReferencia: 0.0057 },
      { id: '14', nome: 'Outros', pesoBrutoReferencia: 0.0064 },
      { id: '15', nome: 'Lazer', pesoBrutoReferencia: 0.0123 },
      { id: '16', nome: 'Apoio familiar', pesoBrutoReferencia: 0.0261 },
      { id: '17', nome: 'Tarifas financeiras', pesoBrutoReferencia: 0.0079 },
      { id: '18', nome: 'Financeiro', pesoBrutoReferencia: 0.0000 },
      { id: '19', nome: 'Trabalho', pesoBrutoReferencia: 0.0007 },
      { id: '20', nome: 'Desconhecida', pesoBrutoReferencia: 0.0066 },
      { id: '21', nome: 'Tecnologia', pesoBrutoReferencia: 0.0035 },
    ];

    const resultado = normalizarCestaCategorias(mockCategorias);

    expect(resultado).toHaveLength(21);

    const soma = resultado.reduce((acc, cat) => acc + cat.referenciaNormalizadaPct, 0);
    // Deve ser exatamente 100.00 com precisão matemática
    expect(Number(soma.toFixed(2))).toBe(100.00);

    // Categoria com peso 0 deve permanecer 0.00
    const financeiro = resultado.find((c) => c.nome === 'Financeiro');
    expect(financeiro?.referenciaNormalizadaPct).toBe(0.00);
  });

  it('deve lidar com lista vazia', () => {
    const resultado = normalizarCestaCategorias([]);
    expect(resultado).toEqual([]);
  });

  it('deve lidar com caso onde todos os pesos são 0', () => {
    const categoriasZero = [
      { id: '1', nome: 'A', pesoBrutoReferencia: 0 },
      { id: '2', nome: 'B', pesoBrutoReferencia: 0 },
      { id: '3', nome: 'C', pesoBrutoReferencia: 0 },
    ];

    const resultado = normalizarCestaCategorias(categoriasZero);
    const soma = resultado.reduce((acc, cat) => acc + cat.referenciaNormalizadaPct, 0);
    expect(Number(soma.toFixed(2))).toBe(100.00);
  });
});
