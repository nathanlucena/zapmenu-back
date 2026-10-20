/**
 * Regra de dependência da clean architecture. Vale para os módulos que já têm
 * camadas (domain/application/infra); os demais ganham camadas quando forem tocados.
 */
const TESTES = '(\\.test\\.ts$|/__mocks__/)';

module.exports = {
  forbidden: [
    {
      name: 'domain-nao-depende-de-fora',
      comment: 'O domínio só conhece o próprio domínio e o que é transversal em shared/errors.',
      severity: 'error',
      from: { path: '^src/[^/]+/domain/' },
      to: { pathNot: ['^src/[^/]+/domain/', '^src/shared/errors/'] },
    },
    {
      name: 'application-nao-conhece-adapters',
      comment: 'Use cases falam com o mundo só por ports: nada de infra, HTTP, WhatsApp, banco ou main.',
      severity: 'error',
      from: { path: '^src/[^/]+/application/', pathNot: TESTES },
      to: { path: ['^src/[^/]+/infra/', '^src/http/', '^src/whatsapp/', '^src/shared/db/', '^src/config/', '^src/main\\.ts$'] },
    },
    {
      name: 'nucleo-sem-framework',
      severity: 'error',
      from: { path: '^src/[^/]+/(domain|application)/', pathNot: TESTES },
      to: {
        dependencyTypes: ['npm', 'npm-dev'],
        path: 'node_modules/(fastify|@fastify|@prisma|prisma|zod|openai|@wppconnect-team)',
      },
    },
    {
      name: 'ninguem-importa-main',
      severity: 'error',
      from: {},
      to: { path: '^src/main\\.ts$' },
    },
    {
      name: 'sem-infra-de-outro-modulo',
      comment: 'Um módulo usa o application de outro, nunca o infra.',
      severity: 'error',
      from: { path: '^src/([^/]+)/', pathNot: ['^src/main\\.ts$', TESTES] },
      to: { path: '^src/[^/]+/infra/', pathNot: '^src/$1/' },
    },
    {
      name: 'sem-ciclos',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    parser: 'swc',
  },
};
