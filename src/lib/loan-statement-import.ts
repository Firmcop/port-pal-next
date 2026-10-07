/**
 * Parser for bank loan statements (KCB "Arrangement Details" layout).
 *
 * The statement lists both the receipt line ("Loan Repayment") and the way the
 * receipt was applied ("Principal Payment" / "Interest Payment" / "Penalty
 * Interest Payment"). Only the application lines are imported — importing the
 * receipt as well would double-count the cash.
 */

export type LoanTxnType =
  | "disbursement"
  | "charges"
  | "stamp_duty"
  | "insurance"
  | "interest_due"
  | "penalty_interest_due"
  | "principal_payment"
  | "interest_payment"
  | "penalty_payment"
  | "write_off"
  | "adjustment";

export type ParsedLoanRow = {
  txn_date: string; // yyyy-MM-dd
  value_date?: string;
  txn_type: LoanTxnType;
  description: string;
  amount: number;
  statement_balance?: number;
};

export type ParsedLoanHeader = {
  reference?: string;
  currency?: string;
  product?: string;
  interest_rate?: number;
  principal_amount?: number;
  current_principal?: number;
  date_granted?: string;
  maturity_date?: string;
  repayment_amount?: number;
  payment_day?: number;
  frequency?: string;
  total_in_arrears?: number;
};

export type ParseResult = {
  header: ParsedLoanHeader;
  rows: ParsedLoanRow[];
  ignored: number;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DATE_RE = /\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/g;
const NUM_RE = /-?\(?\d[\d,]*\.\d{2}\)?/g;

/** Narrations that carry no accounting effect of their own. */
const IGNORED = [
  "loan repayment",
  "settlement through instructions",
  "balance brought fwd",
  "balance carried fwd",
  "opening balance",
];

const NARRATION_MAP: Array<[RegExp, LoanTxnType]> = [
  [/loan disbursement|disburse/i, "disbursement"],
  [/stamp duty/i, "stamp_duty"],
  [/insurance/i, "insurance"],
  [/penalty interest due|penalty due/i, "penalty_interest_due"],
  [/penalty interest payment|penalty payment/i, "penalty_payment"],
  [/interest due/i, "interest_due"],
  [/interest payment/i, "interest_payment"],
  [/principal payment|principal repayment/i, "principal_payment"],
  [/charge|fee|commission|excise|levy/i, "charges"],
  [/write.?off/i, "write_off"],
];

export function classifyNarration(narration: string): LoanTxnType | null {
  const n = narration.trim().toLowerCase();
  if (!n) return null;
  if (IGNORED.some((i) => n.includes(i))) return null;
  for (const [re, type] of NARRATION_MAP) if (re.test(n)) return type;
  return null;
}

export function parseStatementDate(raw: string): string | null {
  const m = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (!mon) return null;
  const d = Number(m[1]);
  if (d < 1 || d > 31) return null;
  return `${m[3]}-${String(mon).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function toNumber(raw: string): number {
  const neg = raw.includes("(") || raw.trim().startsWith("-");
  const n = Number(raw.replace(/[(),-]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

/** Strips HTML table markup so pasted PDF/HTML tables collapse into plain rows. */
function normalise(text: string): string[] {
  return text
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, "\t")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
}

export function parseLoanStatementHeader(text: string): ParsedLoanHeader {
  const flat = text.replace(/\*\*/g, "").replace(/\s+/g, " ");
  const pick = (re: RegExp) => {
    const m = re.exec(flat);
    return m ? m[1].trim() : undefined;
  };
  const num = (v?: string) => (v ? toNumber(v) || Number(v.replace(/,/g, "")) || undefined : undefined);

  const freq = pick(/Payment Frequency\s*:?\s*([A-Za-z]+(?: on day \d{1,2})?)/i);
  const dayMatch = freq ? /on day (\d{1,2})/i.exec(freq) : null;

  return {
    reference: pick(/Loan Reference\s*:?\s*([A-Z0-9]+)/i),
    currency: pick(/Currency\s*:?\s*([A-Z]{3})\b/i),
    product: pick(/Product\s*:?\s*([^:]+?)\s+Interest Rate/i),
    interest_rate: num(pick(/Interest Rate\s*:?\s*([\d.,]+)/i)),
    principal_amount: num(pick(/Princip(?:le|al) advanced\s*:?\s*([\d.,]+)/i)),
    current_principal: num(pick(/Current principal\s*:?\s*([\d.,]+)/i)),
    date_granted: parseStatementDate(pick(/Date Granted\s*:?\s*(\d{1,2} [A-Za-z]{3,9} \d{4})/i) ?? "") ?? undefined,
    maturity_date: parseStatementDate(pick(/Maturity Date\s*:?\s*(\d{1,2} [A-Za-z]{3,9} \d{4})/i) ?? "") ?? undefined,
    repayment_amount: num(pick(/Repayment Amount\s*:?\s*([\d.,]+)/i)),
    frequency: freq ? freq.split(" ")[0].toLowerCase() : undefined,
    payment_day: dayMatch ? Number(dayMatch[1]) : undefined,
    total_in_arrears: num(pick(/Total In Arrears\s*:?\s*([\d.,]+)/i)),
  };
}

export function parseLoanStatement(text: string): ParseResult {
  const header = parseLoanStatementHeader(text);
  const rows: ParsedLoanRow[] = [];
  let ignored = 0;

  for (const line of normalise(text)) {
    DATE_RE.lastIndex = 0;
    const dates = [...line.matchAll(DATE_RE)];
    if (!dates.length) continue;
    if (!/^\s*\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}/.test(line)) continue;

    const txnDate = parseStatementDate(dates[0][0]);
    if (!txnDate) continue;
    const valueDate = dates[1] ? parseStatementDate(dates[1][0]) ?? undefined : undefined;

    // narration sits between the first date and either the value date or the first amount
    const afterFirst = line.slice(dates[0].index! + dates[0][0].length);
    const cutIdx = dates[1]
      ? afterFirst.indexOf(dates[1][0])
      : (() => {
          NUM_RE.lastIndex = 0;
          const m = NUM_RE.exec(afterFirst);
          return m ? m.index : afterFirst.length;
        })();
    const narration = afterFirst.slice(0, cutIdx).replace(/[|\t]/g, " ").trim();

    const type = classifyNarration(narration);
    if (!type) {
      if (narration) ignored += 1;
      continue;
    }

    NUM_RE.lastIndex = 0;
    const nums = (line.match(NUM_RE) ?? []).map(toNumber);
    if (!nums.length) continue;

    // KCB columns: Money In | Payment | Money Out | Running Balance
    let amount = 0;
    let balance: number | undefined;
    if (nums.length >= 4) {
      const [moneyIn, payment, moneyOut, running] = nums.slice(-4);
      amount = payment !== 0 ? Math.abs(payment) : moneyOut !== 0 ? Math.abs(moneyOut) : Math.abs(moneyIn);
      balance = Math.abs(running);
    } else {
      amount = Math.abs(nums.find((n) => n !== 0) ?? 0);
      balance = nums.length > 1 ? Math.abs(nums[nums.length - 1]) : undefined;
    }
    if (!amount) continue;

    rows.push({
      txn_date: txnDate,
      value_date: valueDate,
      txn_type: type,
      description: narration,
      amount: Number(amount.toFixed(2)),
      statement_balance: balance,
    });
  }

  return { header, rows, ignored };
}

export function summariseRows(rows: ParsedLoanRow[]) {
  const by = (types: LoanTxnType[]) =>
    rows.filter((r) => types.includes(r.txn_type)).reduce((s, r) => s + r.amount, 0);
  return {
    count: rows.length,
    disbursed: by(["disbursement"]),
    principalPaid: by(["principal_payment"]),
    interestCharged: by(["interest_due", "penalty_interest_due"]),
    interestPaid: by(["interest_payment", "penalty_payment"]),
    fees: by(["charges", "stamp_duty", "insurance"]),
  };
}
