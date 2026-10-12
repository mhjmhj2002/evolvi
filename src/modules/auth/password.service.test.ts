import { describe, it, expect } from 'vitest';
import { hashPassword, comparePassword } from './password.service.js';

describe('PasswordService', () => {
  it('deve gerar hash bcrypt e validar senha correta', async () => {
    const password = 'MinhaSenhaSegura123!';
    const hash = await hashPassword(password);

    expect(hash).toBeDefined();
    expect(hash).not.toBe(password);
    expect(hash.startsWith('$2')).toBe(true);

    const match = await comparePassword(password, hash);
    expect(match).toBe(true);
  });

  it('deve rejeitar senha incorreta', async () => {
    const password = 'MinhaSenhaSegura123!';
    const hash = await hashPassword(password);

    const match = await comparePassword('SenhaErrada', hash);
    expect(match).toBe(false);
  });
});
