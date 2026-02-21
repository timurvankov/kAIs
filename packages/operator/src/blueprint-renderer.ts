import nunjucks from 'nunjucks';

const env = new nunjucks.Environment(null, { autoescape: false });

/**
 * Recursively render nunjucks templates in an object.
 * Strings containing {{ }} or {% %} are rendered; everything else passes through.
 */
export function renderBlueprint(
  template: unknown,
  params: Record<string, unknown>,
): any {
  if (typeof template === 'string') {
    if (!template.includes('{{') && !template.includes('{%')) {
      return template;
    }
    const rendered = env.renderString(template, params).trim();
    // Try to coerce to number/boolean
    if (rendered === 'true') return true;
    if (rendered === 'false') return false;
    const num = Number(rendered);
    if (!isNaN(num) && rendered !== '') return num;
    return rendered;
  }

  if (Array.isArray(template)) {
    return template.map((item) => renderBlueprint(item, params));
  }

  if (template !== null && typeof template === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template)) {
      result[key] = renderBlueprint(value, params);
    }
    return result;
  }

  return template; // number, boolean, null
}
