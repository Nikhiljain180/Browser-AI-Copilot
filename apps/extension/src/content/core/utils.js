function isElementVisible(element) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && window.getComputedStyle(element).display !== 'none';
}

function normalizeDataKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'value';
}

// React tracks value via the prototype setter; bypassing it makes React revert the change.
function setNativeValue(element, value) {
  const proto = Object.getPrototypeOf(element);
  const protoDescriptor = proto && Object.getOwnPropertyDescriptor(proto, 'value');
  const ownDescriptor = Object.getOwnPropertyDescriptor(element, 'value');

  if (ownDescriptor && protoDescriptor && ownDescriptor.set !== protoDescriptor.set) {
    protoDescriptor.set.call(element, value);
    return;
  }

  if (protoDescriptor && protoDescriptor.set) {
    protoDescriptor.set.call(element, value);
    return;
  }

  element.value = value;
}