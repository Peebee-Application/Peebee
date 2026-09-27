/** Customer fares use UGX 500 increments. Move to the next increment only
 * above UGX 350 into the interval: 2,350 -> 2,000; 2,351 -> 2,500.
 * Preserve configured minimum fares; never round item prices here. */
export function roundFare(amount: number, minimum = 500): number {
  const lower = Math.floor(amount / 500) * 500;
  const rounded = amount - lower > 350 ? lower + 500 : lower;
  return Math.max(rounded, Math.ceil(Math.max(minimum, 500) / 500) * 500);
}
