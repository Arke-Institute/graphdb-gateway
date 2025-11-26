/**
 * Validation utility functions
 */

/**
 * Validate that required fields are present in request body
 */
export function validateRequired(
  body: any,
  fields: string[]
): { valid: boolean; missing?: string[] } {
  const missing = fields.filter((field) => !body[field]);
  return missing.length > 0 ? { valid: false, missing } : { valid: true };
}

/**
 * Check if an entity is a placeholder
 * Placeholder = type "unknown" AND empty properties
 */
export function isPlaceholder(entity: {
  type: string;
  properties: Record<string, any>;
}): boolean {
  return (
    entity.type === 'unknown' && Object.keys(entity.properties).length === 0
  );
}
