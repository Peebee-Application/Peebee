/**
 * Splits a migration file into individual statements.
 *
 * A plain `sql.split(";")` also splits on semicolons inside comments and
 * string literals, which produces fragments that aren't valid SQL. The
 * migration files used to carry a warning telling authors never to write a
 * semicolon in a comment — a rule that was quietly broken twice anyway, in
 * ordinary prose like "nothing changes until they do; ...". Understanding
 * quotes and comments is a few lines of code and removes the rule entirely.
 *
 * Comments are dropped rather than passed through: the database has no use
 * for them, and dropping them keeps the logged statement count honest.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  let trigger = false, blockDepth = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    // -- line comment: skip to the end of the line.
    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end + 1;
      current += "\n";
      continue;
    }

    // /* block comment */
    if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      current += " ";
      continue;
    }

    // Quoted text is copied out whole, so anything inside it — semicolons,
    // double dashes — is data, not syntax. Covers 'literals' and the
    // "identifiers" SQLite allows. A doubled quote is an escaped one and
    // does not end the run.
    if (ch === "'" || ch === '"') {
      const start = i;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      current += sql.slice(start, i);
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      const start = i++;
      while (i < sql.length && /[A-Za-z0-9_]/.test(sql[i])) i++;
      const word = sql.slice(start, i);
      current += word;
      if (word.toUpperCase() === 'TRIGGER' && /^\s*CREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\b/i.test(current)) trigger = true;
      if (trigger && /^(BEGIN|CASE)$/i.test(word)) blockDepth++;
      if (trigger && /^END$/i.test(word)) blockDepth--;
      continue;
    }

    if (ch === ";" && trigger && blockDepth > 0) { current += ch; i++; continue; }
    if (ch === ";") {
      statements.push(current);
      current = "";
      trigger = false; blockDepth = 0;
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  statements.push(current);
  return statements.map((s) => s.trim()).filter(Boolean);
}
