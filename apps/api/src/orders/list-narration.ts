type Row = Record<string, unknown>;

const ugx = (n: number) => `UGX ${n.toLocaleString("en-UG")}`;

/**
 * Builds the plain-English sentence that gets translated to Luganda and
 * read aloud to the rider — see ../speech/sunbird.ts. `list_items` has no
 * unit column (quantity is a bare integer; size/unit lives in the
 * free-text name), so this only ever states what the data actually holds:
 * quantity, name, and — when set — unit price and a per-item and grand
 * total, so the rider hears exactly what they're expected to pay for each
 * item, not just what to buy.
 */
export function buildListSentence(items: Row[]): string {
  let grandTotal = 0;
  const lines = items.map((item) => {
    const quantity = Number(item.quantity) || 1;
    const name = String(item.name);
    const head = quantity > 1 ? `${quantity} ${name}` : name;
    const unitPrice = item.unit_price != null ? Number(item.unit_price) : null;
    if (unitPrice == null) return head;
    const lineTotal = quantity * unitPrice;
    grandTotal += lineTotal;
    return `${head}, at ${ugx(unitPrice)} each, total ${ugx(lineTotal)}`;
  });
  const totalClause = grandTotal > 0 ? ` Grand total: ${ugx(grandTotal)}.` : "";
  return `Buy ${lines.join("; ")}.${totalClause}`;
}
