// Shared card + page color palette — round-robin by list index

export const CARD_COLORS = [
  "#E8451A", // orange-red
  "#2233CC", // royal blue
  "#1A6B58", // teal
  "#7C3AED", // violet
  "#B45309", // amber-brown
  "#0F766E", // emerald
  "#BE185D", // rose
] as const;

// Darker variants used as the create-page background (same hue, ~50% darker)
export const BG_COLORS = [
  "#6B1A08", // orange-red dark
  "#0E1A6B", // royal blue dark
  "#0A3B30", // teal dark
  "#3A1278", // violet dark
  "#5C2904", // amber dark
  "#063A36", // emerald dark
  "#620D30", // rose dark
] as const;

export function getCardColor(index: number): string {
  return CARD_COLORS[index % CARD_COLORS.length];
}

export function getBgColor(index: number): string {
  return BG_COLORS[index % BG_COLORS.length];
}
