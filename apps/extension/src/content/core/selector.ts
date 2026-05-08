function generateSelector(element) {
  if (!element) return '';
  if (element.id) return `#${CSS.escape(element.id)}`;

  const tagName = element.tagName.toLowerCase();
  const preferredAttributes = [
    'data-action',
    'data-product-id',
    'name',
    'type',
    'role',
    'aria-label'
  ];

  for (const attr of preferredAttributes) {
    const value = element.getAttribute(attr);
    if (value) {
      return `${tagName}[${attr}="${CSS.escape(value)}"]`;
    }
  }

  const classNames = Array.from(element.classList || []).filter(Boolean);
  if (classNames.length > 0) {
    return `${tagName}.${classNames.map(name => CSS.escape(name)).join('.')}`;
  }

  const parent = element.parentElement;
  if (!parent) {
    return tagName;
  }

  const siblingsOfSameTag = Array.from(parent.children)
    .filter(child => child.tagName.toLowerCase() === tagName);

  if (siblingsOfSameTag.length === 1) {
    const parentSelector = generateSelector(parent);
    return `${parentSelector} > ${tagName}`;
  }

  const index = siblingsOfSameTag.indexOf(element);
  const parentSelector = generateSelector(parent);
  return `${parentSelector} > ${tagName}:nth-of-type(${index + 1})`;
}