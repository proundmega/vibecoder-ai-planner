const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Vibecode AI Planner API',
      version: '1.0.0',
      description: 'API documentation for Vibecode AI Planner - project and ticket management with agent orchestration',
    },
    servers: [
      {
        url: '/api',
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtained from /api/auth/login',
        },
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'Agent API key for agent authentication',
        },
      },
      schemas: {
        // BIGSERIAL/BIGINT columns are returned by pg as decimal strings, not numbers.
        NumericId: {
          type: 'string',
          pattern: '^[0-9]+$',
          description: 'BIGSERIAL/BIGINT identifier serialized as a decimal string',
        },
        User: {
          type: 'object',
          properties: {
            id: { $ref: '#/components/schemas/NumericId' },
            name: { type: 'string', nullable: true },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['user', 'member', 'project_admin', 'super_admin'] },
            isActive: { type: 'boolean' },
            currentPlan: { type: 'string' },
            // User.toJSON() serializes these camelCase fields; user_created_by
            // is a nullable BIGINT returned as a decimal string.
            userCreatedBy: { type: 'string', pattern: '^[0-9]+$', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            lockedUntil: { type: 'string', format: 'date-time', nullable: true },
            loginAttempts: { type: 'integer' },
          },
        },
        Project: {
          type: 'object',
          properties: {
            id: { $ref: '#/components/schemas/NumericId' },
            name: { type: 'string' },
            description: { type: 'string', nullable: true },
            ownerId: { $ref: '#/components/schemas/NumericId' },
            ownerName: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Ticket: {
          type: 'object',
          properties: {
            id: { $ref: '#/components/schemas/NumericId' },
            title: { type: 'string' },
            description: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['backlog', 'in_progress', 'review', 'done'] },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical', 'urgent'] },
            ownerId: { $ref: '#/components/schemas/NumericId' },
            projectId: { $ref: '#/components/schemas/NumericId' },
            assigneeId: { type: 'string', pattern: '^[0-9]+$', nullable: true },
            assigneeName: { type: 'string', nullable: true },
            milestoneId: { type: 'string', format: 'uuid', nullable: true },
            estimate: { type: 'integer', minimum: 1, nullable: true },
            // tickets.depends_on is BIGINT[]; pg serializes int8 elements as strings.
            dependsOn: { type: 'array', items: { type: 'string', pattern: '^[0-9]+$' } },
            ready: { type: 'boolean' },
            blockedBy: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', pattern: '^[0-9]+$', nullable: true },
                  title: { type: 'string', nullable: true },
                  status: { type: 'string', nullable: true },
                  phase: { type: 'string', nullable: true },
                  reason: {
                    type: 'string',
                    enum: [
                      'not_done',
                      'dependency_reopened',
                      'missing',
                      'deleted',
                      'self',
                      'cross_project',
                      'unreadable',
                    ],
                  },
                },
              },
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Agent: {
          type: 'object',
          properties: {
            id: { $ref: '#/components/schemas/NumericId' },
            name: { type: 'string' },
            owner_id: { $ref: '#/components/schemas/NumericId' },
            rate_limit: { type: 'integer' },
            max_actions_per_day: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        ErrorDetailsObject: {
          type: 'object',
          additionalProperties: true,
        },
        ErrorDetailsArray: {
          type: 'array',
          items: {},
        },
        Error: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
            details: {
              oneOf: [
                { $ref: '#/components/schemas/ErrorDetailsObject' },
                { $ref: '#/components/schemas/ErrorDetailsArray' },
              ],
            },
          },
        },
        ApiResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object' },
            error: { $ref: '#/components/schemas/Error' },
            message: { type: 'string' },
          },
        },
      },
    },
    security: [{ BearerAuth: [] }],
  },
  apis: ['./src/api/*.js', './src/api/routes.js', './src/api/openapi-metrics.js'],
};

const specs = swaggerJsdoc(options);
module.exports = specs;
