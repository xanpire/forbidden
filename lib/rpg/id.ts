export function makeId(prefix = 'id') {
  const random = Math.random().toString(36).slice(2, 8);
  const timestamp = Date.now().toString(36);
  return `${prefix}_${timestamp}${random}`;
}

export function slug(value: string) {
  return value
    // "Fū" becomes "fu", not "f": accents go, the letters stay.
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
