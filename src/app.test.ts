import { describe, it, expect } from 'vitest';
import { buildApp } from './app.js';

describe('Healthcheck Route', () => {
  it('GET /health deve retornar status ok e timestamp', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe('ok');
    expect(body).toHaveProperty('timestamp');
    expect(body.environment).toBe('test');
    await app.close();
  });
});
