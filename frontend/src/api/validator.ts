interface SchemaDefinition {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
  format?: string;
  pattern?: string;
  nullable?: boolean;
  enum?: string[];
  properties?: Record<string, SchemaDefinition>;
  items?: SchemaDefinition;
  required?: string[];
}

const FORMAT_PATTERNS: Record<string, RegExp> = {
  int64: /^[0-9]+$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
};

const schemas: Record<string, SchemaDefinition> = {
  User: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'int64' },
      name: { type: 'string', nullable: true },
      email: { type: 'string', format: 'email' },
      role: { type: 'string', enum: ['user', 'member', 'project_admin', 'super_admin'] },
      isActive: { type: 'boolean' },
      currentPlan: { type: 'string' },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'name', 'email', 'role', 'isActive'],
  },
  Project: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'int64' },
      name: { type: 'string' },
      description: { type: 'string', nullable: true },
      ownerId: { type: 'string', format: 'int64' },
      ownerName: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'name', 'ownerId'],
  },
  Ticket: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'int64' },
      title: { type: 'string' },
      description: { type: 'string', nullable: true },
      status: { type: 'string', enum: ['backlog', 'in_progress', 'review', 'done'] },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical', 'urgent'] },
      ownerId: { type: 'string', format: 'int64' },
      projectId: { type: 'string', format: 'int64' },
      assigneeId: { type: 'string', format: 'int64', nullable: true },
      assigneeName: { type: 'string', nullable: true },
      milestoneId: { type: 'string', format: 'uuid', nullable: true },
      estimate: { type: 'number', nullable: true },
      // BIGINT[] from pg: each element is a decimal string.
      dependsOn: { type: 'array', items: { type: 'string', format: 'int64' } },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'title', 'status', 'ownerId', 'projectId'],
  },
  // AgentService.list() returns raw DB rows, so this contract is snake_case.
  Agent: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'int64' },
      name: { type: 'string' },
      owner_id: { type: 'string', format: 'int64' },
      rate_limit: { type: 'number' },
      max_actions_per_day: { type: 'number' },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'name', 'owner_id'],
  },
};

function validateValue(value: unknown, schema: SchemaDefinition, path: string = 'root'): string[] {
  const errors: string[] = [];

  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push(`${path}: expected object, got ${typeof value}`);
      return errors;
    }

    const required = schema.required || [];
    for (const field of required) {
      if (!(field in (value as object))) {
        errors.push(`${path}.${field}: required field missing`);
      }
    }

    const properties = schema.properties || {};
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in (value as object)) {
        const childErrors = validateValue((value as Record<string, unknown>)[key], propSchema, `${path}.${key}`);
        errors.push(...childErrors);
      }
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array, got ${typeof value}`);
      return errors;
    }
    const itemsSchema = schema.items;
    if (itemsSchema) {
      for (let i = 0; i < value.length; i++) {
        errors.push(...validateValue(value[i], itemsSchema, `${path}[${i}]`));
      }
    }
  } else {
    if (schema.nullable && value === null) {
      return errors;
    }
    const actualType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (schema.type !== actualType) {
      errors.push(`${path}: expected ${schema.type}, got ${actualType}`);
      return errors;
    }
    if (schema.enum && !schema.enum.includes(String(value))) {
      errors.push(`${path}: expected one of ${schema.enum.join(', ')}, got ${value}`);
    }
    const pattern = schema.pattern
      ? new RegExp(schema.pattern)
      : (schema.format ? FORMAT_PATTERNS[schema.format] : undefined);
    if (pattern && typeof value === 'string' && !pattern.test(value)) {
      errors.push(`${path}: does not match ${schema.pattern || schema.format}`);
    }
  }

  return errors;
}

export function validateUser(data: unknown): string[] {
  return validateValue(data, schemas.User);
}

export function validateProject(data: unknown): string[] {
  return validateValue(data, schemas.Project);
}

export function validateTicket(data: unknown): string[] {
  return validateValue(data, schemas.Ticket);
}

export function validateAgent(data: unknown): string[] {
  return validateValue(data, schemas.Agent);
}

export function validateApiResponse(data: unknown): string[] {
  const errors: string[] = [];
  if (typeof data !== 'object' || data === null) {
    errors.push('root: response must be an object');
    return errors;
  }

  const obj = data as Record<string, unknown>;
  if (!('success' in obj)) {
    errors.push('root.success: required field missing');
  } else if (typeof obj.success !== 'boolean') {
    errors.push('root.success: must be boolean');
  }

  if (!('data' in obj)) {
    errors.push('root.data: required field missing');
  }

  return errors;
}

export function validateApiResponseStrict(data: unknown): void {
  const errors = validateApiResponse(data);
  if (errors.length > 0) {
    throw new Error(`API response validation failed: ${errors.join('; ')}`);
  }
}

export function validateSchema(schemaName: string) {
  const schema = schemas[schemaName];
  if (!schema) {
    throw new Error(`Unknown schema: ${schemaName}`);
  }
  return (data: unknown): void => {
    const errors = validateValue(data, schema, schemaName);
    if (errors.length > 0) {
      throw new Error(`${schemaName} validation failed: ${errors.join('; ')}`);
    }
  };
}

export function validateAndExtract<T>(data: unknown, validator: (data: unknown) => string[], expectedType: string): T {
  const errors = validator(data);
  if (errors.length > 0) {
    const errorMsg = `API response validation failed for ${expectedType}: ${errors.join('; ')}`;
    throw new Error(errorMsg);
  }
  return data as T;
}
