interface SchemaDefinition {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
  format?: string;
  enum?: string[];
  properties?: Record<string, SchemaDefinition>;
  items?: SchemaDefinition;
  required?: string[];
}

const schemas: Record<string, SchemaDefinition> = {
  User: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
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
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      description: { type: 'string' },
      owner_id: { type: 'string', format: 'uuid' },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'name', 'owner_id'],
  },
  Ticket: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      title: { type: 'string' },
      description: { type: 'string' },
      status: { type: 'string', enum: ['backlog', 'in_progress', 'review', 'done'] },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
      owner_id: { type: 'string', format: 'uuid' },
      project_id: { type: 'string', format: 'uuid' },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'title', 'status', 'owner_id', 'project_id'],
  },
  Agent: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      user_id: { type: 'string', format: 'uuid' },
      api_key: { type: 'string' },
      is_active: { type: 'boolean' },
      created_at: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'name', 'user_id'],
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
        validateValue(value[i], itemsSchema, `${path}[${i}]`);
      }
    }
  } else {
    if (schema.enum && !schema.enum.includes(String(value))) {
      errors.push(`${path}: expected one of ${schema.enum.join(', ')}, got ${value}`);
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
