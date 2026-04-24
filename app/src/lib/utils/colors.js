/**
 * Color utilities for graph comparison visualization.
 * Provides consistent color generation across all views.
 */

// Extended color palette for comparison - 16 hand-picked distinguishable colors
export const baseComparisonColors = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#10b981', // green
  '#f59e0b', // amber
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#6366f1', // indigo
  '#84cc16', // lime
  '#06b6d4', // cyan
  '#f43f5e', // rose
  '#a855f7', // violet
  '#eab308', // yellow
  '#22d3ee', // light cyan
  '#fb7185', // light rose
];

/**
 * Generate unlimited distinct colors using optimized HSL distribution.
 * Uses the base palette for indices 0-15, then generates new colors
 * using prime-based hue rotation for better visual distinction.
 *
 * @param {number} index - The index of the color to generate
 * @returns {string} A CSS color string (hex or hsl)
 */
export function generateComparisonColor(index) {
  if (index < baseComparisonColors.length) {
    return baseComparisonColors[index];
  }
  // For indices beyond base palette, use prime-based hue distribution
  // This avoids clustering that can happen with simple golden angle
  const adjustedIndex = index - baseComparisonColors.length;
  const primes = [
    47,
    53,
    59,
    61,
    67,
  ]; // Various primes for better spread
  const primeOffset = primes[adjustedIndex % primes.length];
  const hue = (adjustedIndex * primeOffset + 30) % 360; // Offset to avoid base palette hues
  // Alternate saturation and lightness to maximize visual distinction
  const saturationLevels = [
    70,
    55,
    85,
    60,
    75,
  ];
  const lightnessLevels = [
    50,
    40,
    55,
    45,
    60,
  ];
  const saturation = saturationLevels[adjustedIndex % saturationLevels.length];
  const lightness = lightnessLevels[Math.floor(adjustedIndex / 5) % lightnessLevels.length];
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * Generate a consistent color for any node based on a hash of its ID.
 * Useful for coloring nodes consistently across different views.
 *
 * @param {string} nodeId - The node ID to hash
 * @returns {string} A CSS color string
 */
export function getColorForNode(nodeId) {
  // Simple hash function to convert node ID to a number
  let hash = 0;
  for (let i = 0; i < nodeId.length; i++) {
    hash = nodeId.charCodeAt(i) + ((hash << 5) - hash);
    hash &= hash; // Convert to 32bit integer
  }
  // Use absolute value and modulo to get a positive index
  const index = Math.abs(hash) % 360; // Use 360 for hue variation
  return generateComparisonColor(index);
}
