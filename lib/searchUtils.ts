/**
 * Normalizes string for case-insensitive, accent-insensitive (including Vietnamese characters) comparison.
 */
export const normalizeSearchText = (str: string): string => {
  if (!str) return '';
  return str
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/đ/g, 'd')             // Standardize lowercase 'đ' to 'd'
    .replace(/Đ/g, 'd')             // Standardize uppercase 'Đ' to 'd'
    .trim();
};

/**
 * Checks if a target string contains the search query, using case-insensitive and Vietnamese-tone-insensitive matching.
 */
export const matchesSearchQuery = (target: string | undefined | null, query: string): boolean => {
  if (!query) return true;
  if (!target) return false;
  
  const normalizedTarget = normalizeSearchText(target);
  const normalizedQuery = normalizeSearchText(query);
  
  return normalizedTarget.includes(normalizedQuery);
};

/**
 * Checks if a list of target strings matches the search query. Returns true if all words in query are present in the targets.
 */
export const matchesSearchQueryMultiple = (targets: (string | undefined | null)[], query: string): boolean => {
  if (!query || !query.trim()) return true;
  
  const normalizedQuery = normalizeSearchText(query);
  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);
  
  const combinedTarget = targets
    .filter(Boolean)
    .map(t => normalizeSearchText(t!))
    .join(' ');
    
  return queryWords.every(word => combinedTarget.includes(word));
};
