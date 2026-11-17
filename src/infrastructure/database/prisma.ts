import { PrismaClient } from '@prisma/client';

let contadorConsultas = 0;
const medirConsultas = process.env.EVOLVI_MEDIR_CONSULTAS === '1';
const prisma = new PrismaClient(medirConsultas ? { log: [{ emit: 'event', level: 'query' }] } : undefined);
if (medirConsultas) prisma.$on('query', () => { contadorConsultas += 1; });

export function reiniciarContadorConsultas(): void { contadorConsultas = 0; }
export function obterContadorConsultas(): number { return contadorConsultas; }

export { prisma };
