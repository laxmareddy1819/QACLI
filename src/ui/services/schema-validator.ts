/**
 * Lightweight JSON Schema Draft-07 validator.
 * No external dependencies — recursive validation of types, properties,
 * required fields, arrays, enums, patterns, and basic $ref resolution.
 */

export interface ValidationError {
  path: string;
  message: string;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Validate data against a JSON Schema Draft-07 schema.
 * Returns an array of validation errors (empty = valid).
 */
export function validateJsonSchema(data: unknown, schema: Record<string, unknown>): ValidationError[] {
  return validate(data, schema, '$', schema);
}

/**
 * Parse an OpenAPI 3.x (JSON format) specification.
 * Returns the parsed object — YAML is not supported (no parser dependency).
 */
export function parseOpenApiSpec(content: string): Record<string, unknown> {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error('Failed to parse OpenAPI spec — only JSON format is supported');
  }
}

/**
 * Extract a component schema from an OpenAPI spec by name.
 * Looks in components.schemas (OpenAPI 3.x) or definitions (Swagger 2.x).
 */
export function extractComponentSchema(
  spec: Record<string, unknown>,
  componentName: string,
): Record<string, unknown> | undefined {
  // OpenAPI 3.x
  const components = spec.components as Record<string, unknown> | undefined;
  if (components) {
    const schemas = components.schemas as Record<string, Record<string, unknown>> | undefined;
    if (schemas?.[componentName]) return schemas[componentName];
  }

  // Swagger 2.x
  const definitions = spec.definitions as Record<string, Record<string, unknown>> | undefined;
  if (definitions?.[componentName]) return definitions[componentName];

  return undefined;
}

/**
 * Resolve in-document $ref references.
 * Supports: `#/components/schemas/Foo`, `#/definitions/Foo`.
 */
export function resolveRef(ref: string, rootDoc: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!ref.startsWith('#/')) return undefined;
  const parts = ref.slice(2).split('/');
  let current: unknown = rootDoc;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current as Record<string, unknown> | undefined;
}

// ── Internal Validation ─────────────────────────────────────────────────────

function validate(
  data: unknown,
  schema: Record<string, unknown>,
  path: string,
  rootDoc: Record<string, unknown>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Handle $ref
  if (schema.$ref && typeof schema.$ref === 'string') {
    const resolved = resolveRef(schema.$ref, rootDoc);
    if (!resolved) {
      errors.push({ path, message: `Unresolved $ref: ${schema.$ref}` });
      return errors;
    }
    return validate(data, resolved, path, rootDoc);
  }

  // allOf
  if (Array.isArray(schema.allOf)) {
    for (const subSchema of schema.allOf) {
      errors.push(...validate(data, subSchema as Record<string, unknown>, path, rootDoc));
    }
    return errors;
  }

  // anyOf
  if (Array.isArray(schema.anyOf)) {
    const anyErrors = (schema.anyOf as Record<string, unknown>[]).map(
      sub => validate(data, sub, path, rootDoc),
    );
    if (anyErrors.every(e => e.length > 0)) {
      errors.push({ path, message: `Value does not match any of the anyOf schemas` });
    }
    return errors;
  }

  // oneOf
  if (Array.isArray(schema.oneOf)) {
    const matchCount = (schema.oneOf as Record<string, unknown>[])
      .filter(sub => validate(data, sub, path, rootDoc).length === 0).length;
    if (matchCount !== 1) {
      errors.push({ path, message: `Value must match exactly one of the oneOf schemas (matched ${matchCount})` });
    }
    return errors;
  }

  // Type check
  if (schema.type) {
    const schemaType = schema.type as string;
    const actualType = getJsonType(data);

    if (schemaType === 'integer') {
      if (typeof data !== 'number' || !Number.isInteger(data)) {
        errors.push({ path, message: `Expected integer, got ${actualType}` });
        return errors;
      }
    } else if (schemaType !== actualType) {
      // Allow null if nullable is true
      if (data === null && schema.nullable === true) {
        return errors;
      }
      errors.push({ path, message: `Expected ${schemaType}, got ${actualType}` });
      return errors;
    }
  }

  // Enum
  if (Array.isArray(schema.enum)) {
    if (!(schema.enum as unknown[]).includes(data)) {
      errors.push({ path, message: `Value not in enum: [${(schema.enum as unknown[]).join(', ')}]` });
    }
  }

  // const
  if (schema.const !== undefined) {
    if (data !== schema.const) {
      errors.push({ path, message: `Expected const value: ${JSON.stringify(schema.const)}` });
    }
  }

  // Object validation
  if (schema.type === 'object' && typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
    const required = (schema.required || []) as string[];
    const additionalProperties = schema.additionalProperties;

    // Required check
    for (const req of required) {
      if (!(req in obj)) {
        errors.push({ path, message: `Missing required property: "${req}"` });
      }
    }

    // Property validation
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in obj) {
        errors.push(...validate(obj[key], propSchema, `${path}.${key}`, rootDoc));
      }
    }

    // Additional properties
    if (additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in properties)) {
          errors.push({ path: `${path}.${key}`, message: `Unexpected additional property: "${key}"` });
        }
      }
    } else if (typeof additionalProperties === 'object' && additionalProperties !== null) {
      for (const key of Object.keys(obj)) {
        if (!(key in properties)) {
          errors.push(...validate(obj[key], additionalProperties as Record<string, unknown>, `${path}.${key}`, rootDoc));
        }
      }
    }

    // Min/max properties
    const propCount = Object.keys(obj).length;
    if (schema.minProperties !== undefined && propCount < (schema.minProperties as number)) {
      errors.push({ path, message: `Object has ${propCount} properties, minimum is ${schema.minProperties}` });
    }
    if (schema.maxProperties !== undefined && propCount > (schema.maxProperties as number)) {
      errors.push({ path, message: `Object has ${propCount} properties, maximum is ${schema.maxProperties}` });
    }
  }

  // Array validation
  if (schema.type === 'array' && Array.isArray(data)) {
    const itemSchema = schema.items as Record<string, unknown> | undefined;
    if (itemSchema) {
      for (let i = 0; i < data.length; i++) {
        errors.push(...validate(data[i], itemSchema, `${path}[${i}]`, rootDoc));
      }
    }

    if (schema.minItems !== undefined && data.length < (schema.minItems as number)) {
      errors.push({ path, message: `Array has ${data.length} items, minimum is ${schema.minItems}` });
    }
    if (schema.maxItems !== undefined && data.length > (schema.maxItems as number)) {
      errors.push({ path, message: `Array has ${data.length} items, maximum is ${schema.maxItems}` });
    }
    if (schema.uniqueItems === true) {
      const set = new Set(data.map(item => JSON.stringify(item)));
      if (set.size !== data.length) {
        errors.push({ path, message: `Array items are not unique` });
      }
    }
  }

  // String validation
  if (schema.type === 'string' && typeof data === 'string') {
    if (schema.minLength !== undefined && data.length < (schema.minLength as number)) {
      errors.push({ path, message: `String length ${data.length} < minimum ${schema.minLength}` });
    }
    if (schema.maxLength !== undefined && data.length > (schema.maxLength as number)) {
      errors.push({ path, message: `String length ${data.length} > maximum ${schema.maxLength}` });
    }
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern as string).test(data)) {
          errors.push({ path, message: `String does not match pattern: ${schema.pattern}` });
        }
      } catch { /* invalid regex */ }
    }
    // Format validation (basic)
    if (schema.format) {
      const formatErr = validateFormat(data, schema.format as string);
      if (formatErr) {
        errors.push({ path, message: formatErr });
      }
    }
  }

  // Number validation
  if ((schema.type === 'number' || schema.type === 'integer') && typeof data === 'number') {
    if (schema.minimum !== undefined && data < (schema.minimum as number)) {
      errors.push({ path, message: `Value ${data} < minimum ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && data > (schema.maximum as number)) {
      errors.push({ path, message: `Value ${data} > maximum ${schema.maximum}` });
    }
    if (schema.exclusiveMinimum !== undefined && data <= (schema.exclusiveMinimum as number)) {
      errors.push({ path, message: `Value ${data} <= exclusive minimum ${schema.exclusiveMinimum}` });
    }
    if (schema.exclusiveMaximum !== undefined && data >= (schema.exclusiveMaximum as number)) {
      errors.push({ path, message: `Value ${data} >= exclusive maximum ${schema.exclusiveMaximum}` });
    }
    if (schema.multipleOf !== undefined) {
      const mod = data % (schema.multipleOf as number);
      if (Math.abs(mod) > 1e-10) {
        errors.push({ path, message: `Value ${data} is not a multiple of ${schema.multipleOf}` });
      }
    }
  }

  return errors;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getJsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function validateFormat(value: string, format: string): string | null {
  switch (format) {
    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `Invalid email format`;
      break;
    case 'uri':
    case 'url':
      try { new URL(value); } catch { return `Invalid URI format`; }
      break;
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return `Invalid date format (expected YYYY-MM-DD)`;
      break;
    case 'date-time':
      if (isNaN(Date.parse(value))) return `Invalid date-time format`;
      break;
    case 'uuid':
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return `Invalid UUID format`;
      break;
    case 'ipv4':
      if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) return `Invalid IPv4 format`;
      break;
  }
  return null;
}
