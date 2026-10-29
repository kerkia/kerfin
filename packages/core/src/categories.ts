// Spending categories: Kerfin's list, which the user can rename, extend and trim. A
// transaction's category is, in this order: the one the user gave its payee; "transfers" when
// it moves money between two of the user's accounts; Kerfin's rule for well-known merchants;
// the bank's category, mapped onto Kerfin's; else "other". Banks' own categorisers err often,
// and the user's corrections stick.
import { amount } from "./analytics";
import type { AccountTransaction } from "./types";

/** What a category's transactions count as in the budget. */
export type CategoryKind = "spending" | "income" | "excluded";

export interface CategoryDef {
  key: string;
  kind: CategoryKind;
  label?: string | null; // the user's name for it; Kerfin's own are named by the UI otherwise
}

/** Money moving between the user's own accounts (savings, a card's bill): not spending. */
export const TRANSFERS = "transfers";
export const OTHER = "other";
/** Transactions the user leaves out of the budget altogether. */
export const IGNORED = "ignored";
/** Categories Kerfin relies on: they can be renamed, not removed. */
export const REQUIRED_CATEGORIES: ReadonlySet<string> = new Set([TRANSFERS, IGNORED, OTHER]);

export const DEFAULT_CATEGORIES: CategoryDef[] = [
  { key: "income", kind: "income" },
  ...[
    "housing",
    "utilities",
    "groceries",
    "restaurants",
    "transport",
    "travel",
    "shopping",
    "health",
    "leisure",
    "subscriptions",
    "insurance",
    "taxes",
    "bank_fees",
    "cash",
    "education",
    "gifts",
  ].map((key): CategoryDef => ({ key, kind: "spending" })),
  { key: TRANSFERS, kind: "excluded" },
  { key: IGNORED, kind: "excluded" },
  { key: OTHER, kind: "spending" },
];

/** The user's list with the categories Kerfin relies on, should a saved list lack some. */
export function withRequired(categories: CategoryDef[]): CategoryDef[] {
  const missing = DEFAULT_CATEGORIES.filter((c) => REQUIRED_CATEGORIES.has(c.key) && !categories.some((m) => m.key === c.key));
  if (!missing.length) return categories;
  // "Other" stays last.
  const all = [...categories, ...missing];
  return [...all.filter((c) => c.key !== OTHER), ...all.filter((c) => c.key === OTHER)];
}

/** Where a transaction's category comes from. */
export type CategoryOrigin = "yours" | "transfer" | "kerfin" | "bank" | "none";

export interface Categorised extends AccountTransaction {
  key: string; // its category
  origin: CategoryOrigin;
  payeeKey: string;
}

/** Lowercase, without accents or punctuation. */
function plain(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Who a transaction pays or comes from, as words that stay the same from one payment to the
 * next: the bank's cleaned-up merchant name, else the label without card and transfer
 * prefixes, dates, card numbers and references.
 */
export function payeeKey(transaction: { label: string; payee?: string | null }): string {
  if (transaction.payee?.trim()) return plain(transaction.payee);
  const words = plain(transaction.label)
    .replace(/\b(carte|cb|paiement|prlv|prelevement|sepa|vir|virement|inst|instantane|recu|emis|de|du|vers|ref|x\d+)\b/g, " ")
    .replace(/\b\d[\d ]*\b/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);
  return words.slice(0, 4).join(" ") || plain(transaction.label);
}

// Well-known French merchants and payees, matched on the payee and the label.
const MERCHANTS: [RegExp, string][] = [
  [/\b(salaire|paie|payroll|pole emploi|france travail|caf|cpam|retraite|pension)\b/, "income"],
  [
    /\b(carrefour|leclerc|auchan|intermarche|monoprix|franprix|lidl|aldi|casino|super u|hyper u|systeme u|picard|biocoop|naturalia|grand frais|netto|cora|g20|spar|proxi|boulangerie|boucherie|primeur)\b/,
    "groceries",
  ],
  [/\b(restaurant|brasserie|mcdonald|mc donald|burger king|kfc|subway|starbucks|deliveroo|uber eats|just eat|pizza|sushi)\b/, "restaurants"],
  [/\b(sncf|ratp|navigo|transilien|uber|bolt|blablacar|totalenergies|esso|shell|avia|vinci autoroutes|sanef|aprr|indigo|parking|peage|velib)\b/, "transport"],
  [/\b(air france|easyjet|ryanair|transavia|vueling|booking|airbnb|expedia|hotel|accor|ibis|novotel|europcar|hertz|sixt)\b/, "travel"],
  [/\b(amazon|fnac|darty|boulanger|decathlon|ikea|leroy merlin|castorama|zara|uniqlo|kiabi|cdiscount|vinted|sephora)\b/, "shopping"],
  [/\b(pharmacie|medecin|docteur|dentiste|kine|ophtalmo|laboratoire|hopital|clinique|doctolib|optique|mutuelle)\b/, "health"],
  [/\b(cinema|ugc|pathe|gaumont|ticketmaster|basic fit|fitness park|neoness|musee|theatre|steam|playstation|nintendo)\b/, "leisure"],
  [/\b(free mobile|freebox|orange|sfr|bouygues|sosh|netflix|spotify|deezer|disney|canal|youtube|icloud)\b/, "subscriptions"],
  [/\b(edf|engie|ekwateur|veolia|suez|saur)\b/, "utilities"],
  [/\b(loyer|foncia|nexity|citya|syndic)\b/, "housing"],
  [/\b(axa|maif|macif|matmut|gmf|allianz|generali|groupama|mma|maaf)\b/, "insurance"],
  [/\b(dgfip|impot|impots|tresor public|amende|antai)\b/, "taxes"],
  [/\b(frais|commission|cotisation|agios)\b/, "bank_fees"],
  [/\b(retrait|dab|distributeur)\b/, "cash"],
  [/\b(ecole|creche|cantine|universite|scolarite)\b/, "education"],
  [/\b(croix rouge|restos du coeur|unicef|msf)\b/, "gifts"],
  [/\b(livret|ldd|pel|american express|amex)\b/, TRANSFERS],
];

// Banks' category names (BoursoBank, Finary...), mapped onto Kerfin's.
const BANK_CATEGORIES: [RegExp, string][] = [
  [/virements? internes?|mouvements? internes?|epargne|placement|investissement|transfert/, TRANSFERS],
  [/salaire|revenu|paie|pension|allocation|indemnit|income|salary/, "income"],
  [/restaura|fast food|\bbars?\b|cafe/, "restaurants"],
  [/aliment|supermarch|courses|epicerie|boulang|groceries/, "groceries"],
  [/voyage|hotel|avion|vacances|travel/, "travel"],
  [/transport|carbur|essence|peage|parking|train|taxi|vtc|auto|vehicule/, "transport"],
  [/energie|electricite|\bgaz\b|\beau\b|utilities/, "utilities"],
  [/logement|loyer|immobilier|travaux|bricolage|jardin|mobilier|maison|housing|rent/, "housing"],
  [/telephon|internet|abonnement|streaming|multimedia|subscription/, "subscriptions"],
  [/sante|pharmac|medec|mutuelle|optique|dentaire|health/, "health"],
  [/assurance|insurance/, "insurance"],
  [/impot|taxe|amende|\btax/, "taxes"],
  [/frais|banque|commission|cotisation|bank/, "bank_fees"],
  [/retrait|especes|\bdab\b|cash/, "cash"],
  [/loisir|sport|culture|cinema|spectacle|sortie|jeux|leisure/, "leisure"],
  [/shopping|vetement|habillement|high tech|electronique|achat/, "shopping"],
  [/enfant|scolarit|education|creche|garde/, "education"],
  [/cadeau|\bdons?\b|association|charit|gift/, "gifts"],
];

function first(rules: [RegExp, string][], text: string, known: ReadonlySet<string>): string | null {
  return rules.find(([pattern, key]) => known.has(key) && pattern.test(text))?.[1] ?? null;
}

/**
 * The transactions that move money between two of the given accounts: an amount out of one
 * and the same amount into another within four days. Indices into `transactions`.
 */
export function transferPairs(transactions: AccountTransaction[]): Set<number> {
  const found = new Set<number>();
  const incoming = new Map<string, number[]>();
  transactions.forEach((tx, i) => {
    const value = amount(tx.amount);
    if (value > 0) incoming.set(value.toFixed(2), [...(incoming.get(value.toFixed(2)) ?? []), i]);
  });
  const day = (date: string) => Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / 86_400_000;
  transactions.forEach((tx, i) => {
    const value = amount(tx.amount);
    if (value >= 0) return;
    const match = (incoming.get((-value).toFixed(2)) ?? []).find(
      (j) =>
        !found.has(j) &&
        transactions[j]!.account_id !== tx.account_id &&
        Math.abs(day(transactions[j]!.date) - day(tx.date)) <= 4,
    );
    if (match !== undefined) {
      found.add(i);
      found.add(match);
    }
  });
  return found;
}

/**
 * Each transaction with its category among `categories`, the user's `rules` (payee key ->
 * category) first. A category no longer in the list falls back to the next source.
 */
export function categorise(
  transactions: AccountTransaction[],
  rules: Record<string, string>,
  categories: CategoryDef[] = DEFAULT_CATEGORIES,
): Categorised[] {
  const known = new Set(categories.map((c) => c.key));
  const transfers = transferPairs(transactions);
  return transactions.map((tx, i) => {
    const key = payeeKey(tx);
    const yours = rules[key];
    if (yours && known.has(yours)) return { ...tx, key: yours, origin: "yours", payeeKey: key };
    if (transfers.has(i)) return { ...tx, key: TRANSFERS, origin: "transfer", payeeKey: key };
    const merchant = first(MERCHANTS, `${key} ${plain(tx.label)}`, known);
    if (merchant) return { ...tx, key: merchant, origin: "kerfin", payeeKey: key };
    const bank = first(BANK_CATEGORIES, plain(`${tx.category_parent ?? ""} ${tx.category ?? ""}`), known);
    if (bank) return { ...tx, key: bank, origin: "bank", payeeKey: key };
    return { ...tx, key: OTHER, origin: "none", payeeKey: key };
  });
}

/** A new category's key, from its name, unlike the existing ones. */
export function categoryKey(name: string, existing: CategoryDef[]): string {
  const base = `my_${plain(name).replace(/ /g, "_") || "category"}`;
  const taken = new Set(existing.map((c) => c.key));
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  return key;
}
