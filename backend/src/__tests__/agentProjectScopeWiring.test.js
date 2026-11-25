const { verifyTokenOrAgent } = require('../middleware/auth');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    }),
    stats: jest.fn(() => ({ idleCount: 1 })),
  },
}));

const routers = {
  tickets: require('../api/tickets'),
  projects: require('../api/projects'),
  github: require('../api/github'),
  repoProfiles: require('../api/repoProfiles'),
  review: require('../api/review'),
  harnessRuns: require('../api/harnessRuns'),
  harnessObservability: require('../api/harnessObservability'),
  v1: require('../api/v1/index'),
};

/**
 * NFR2: every route that accepts an agent X-API-Key must carry a project-scope
 * assertion. This enumerates the real Express routers so a new agent route
 * cannot silently bypass the matrix.
 */
describe('agent project-scope wiring (NFR2)', () => {
  describe.each(Object.entries(routers))('%s router', (_name, router) => {
    it('scopes every agent-authenticated route', () => {
      const unscoped = [];

      for (const layer of router.stack) {
        if (!layer.route) continue;
        const handlers = layer.route.stack.map(entry => entry.handle);
        if (!handlers.includes(verifyTokenOrAgent)) continue;
        if (!handlers.some(handler => handler.agentScope)) {
          unscoped.push(`${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);
        }
      }

      expect(unscoped).toEqual([]);
    });
  });

  it('keeps project observability and kill switches off agent auth', () => {
    const wrong = [];
    for (const layer of routers.harnessObservability.stack) {
      if (!layer.route) continue;
      const handlers = layer.route.stack.map(entry => entry.handle);
      const projectRoute = layer.route.path.startsWith('/projects/')
        || layer.route.path.startsWith('/kill-switch');
      if (projectRoute && handlers.includes(verifyTokenOrAgent)) {
        wrong.push(layer.route.path);
      }
    }
    expect(wrong).toEqual([]);
  });
});
