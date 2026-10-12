import { describe, it, expect } from 'vitest';
import {
  calcularUltimosMesesFechados,
  classificarSemaforo,
} from './baseline.service.js';

describe('Baseline & Semáforo Logic (Unit Tests)', () => {
  describe('calcularUltimosMesesFechados', () => {
    it('deve calcular corretamente 6 meses fechados a partir de 2026-10', () => {
      const meses = calcularUltimosMesesFechados('2026-10', 6);
      expect(meses).toEqual([
        '2026-04',
        '2026-05',
        '2026-06',
        '2026-07',
        '2026-08',
        '2026-09',
      ]);
    });

    it('deve virar o ano corretamente (ex: referência 2026-03)', () => {
      const meses = calcularUltimosMesesFechados('2026-03', 6);
      expect(meses).toEqual([
        '2025-09',
        '2025-10',
        '2025-11',
        '2025-12',
        '2026-01',
        '2026-02',
      ]);
    });

    it('deve virar o ano em janeiro (ex: referência 2026-01)', () => {
      const meses = calcularUltimosMesesFechados('2026-01', 6);
      expect(meses).toEqual([
        '2025-07',
        '2025-08',
        '2025-09',
        '2025-10',
        '2025-11',
        '2025-12',
      ]);
    });
  });

  describe('classificarSemaforo', () => {
    it('deve classificar como VERDE quando delta < -5 p.p.', () => {
      expect(classificarSemaforo(-5.01)).toBe('VERDE');
      expect(classificarSemaforo(-11.22)).toBe('VERDE');
    });

    it('deve classificar como AMARELO nos limites e centro de [-5.0, +5.0]', () => {
      expect(classificarSemaforo(-5.0)).toBe('AMARELO');
      expect(classificarSemaforo(0.0)).toBe('AMARELO');
      expect(classificarSemaforo(5.0)).toBe('AMARELO');
      expect(classificarSemaforo(-4.99)).toBe('AMARELO');
      expect(classificarSemaforo(4.99)).toBe('AMARELO');
    });

    it('deve classificar como VERMELHO quando delta > +5 p.p.', () => {
      expect(classificarSemaforo(5.01)).toBe('VERMELHO');
      expect(classificarSemaforo(6.84)).toBe('VERMELHO');
      expect(classificarSemaforo(25.0)).toBe('VERMELHO');
    });
  });
});
