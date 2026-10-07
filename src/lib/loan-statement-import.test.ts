import { describe, it, expect } from "vitest";
import {
  parseLoanStatement,
  parseLoanStatementHeader,
  classifyNarration,
  summariseRows,
} from "./loan-statement-import";

const KCB_HEADER = `
**Loan Reference :** AA24358K6P1K **Customer :** 40893680 FIRMCOP LIMITED
**Legacy Id :** - **Currency :** KES
**Product :** Long Term- Kenya Unsecured **Interest Rate :** 16.70000
**Principle advanced :** 3,000,000.00 **Current principal :** 1,607,078.00
**Date Granted :** 23 DEC 2024 **Maturity Date:** 23 DEC 2027
**Loan Status :** Current **Payment Frequency :** Monthly on day 23 **Repayment Amount :** 106848.10
`;

const KCB_ROWS = `
Date	Narration	Value Date	Money In	Payment	Money Out	Running Balance
	Balance Brought Fwd		0.00	0.00	0.00	0.00
23 DEC 2024	Stamp Duty Fee	23 DEC 2024	0.00	0.00	-5.00	-5.00
23 DEC 2024	Settlement Through Instructions	23 DEC 2024	0.00	5.00	0.00	0.00
23 DEC 2024	Charges	23 DEC 2024	0.00	0.00	-31,642.00	-31,642.00
23 DEC 2024	Loan Disbursement	23 DEC 2024	0.00	0.00	-3,000,000.00	-3,000,000.00
23 JAN 2025	Interest Due	23 JAN 2025	0.00	0.00	-47,608.80	-3,047,608.80
23 JAN 2025	Loan Repayment	23 JAN 2025	109,514.00	0.00	0.00	-3,047,608.80
23 JAN 2025	Principal Payment	23 JAN 2025	0.00	61,905.20	0.00	-2,985,703.60
23 JAN 2025	Interest Payment	23 JAN 2025	0.00	47,608.80	0.00	-2,938,094.80
23 MAY 2025	Penalty Interest Due	23 MAY 2025	0.00	0.00	-43.55	-2,740,063.55
24 MAY 2025	Penalty Interest Payment	23 MAY 2025	0.00	43.55	0.00	-2,672,122.95

Summary :-
**Total In Arrears:** 77,891
`;

describe("loan statement header", () => {
  it("reads the KCB arrangement block", () => {
    const h = parseLoanStatementHeader(KCB_HEADER);
    expect(h.reference).toBe("AA24358K6P1K");
    expect(h.currency).toBe("KES");
    expect(h.interest_rate).toBeCloseTo(16.7, 3);
    expect(h.principal_amount).toBe(3000000);
    expect(h.date_granted).toBe("2024-12-23");
    expect(h.maturity_date).toBe("2027-12-23");
    expect(h.repayment_amount).toBeCloseTo(106848.1, 2);
    expect(h.frequency).toBe("monthly");
    expect(h.payment_day).toBe(23);
  });
});

describe("narration classification", () => {
  it("ignores receipt and settlement lines", () => {
    expect(classifyNarration("Loan Repayment")).toBeNull();
    expect(classifyNarration("Settlement Through Instructions")).toBeNull();
    expect(classifyNarration("Balance Brought Fwd")).toBeNull();
  });
  it("maps statement narrations to transaction types", () => {
    expect(classifyNarration("Stamp Duty Fee")).toBe("stamp_duty");
    expect(classifyNarration("Charges")).toBe("charges");
    expect(classifyNarration("Loan Disbursement")).toBe("disbursement");
    expect(classifyNarration("Interest Due")).toBe("interest_due");
    expect(classifyNarration("Penalty Interest Due")).toBe("penalty_interest_due");
    expect(classifyNarration("Penalty Interest Payment")).toBe("penalty_payment");
    expect(classifyNarration("Principal Payment")).toBe("principal_payment");
  });
});

describe("loan statement rows", () => {
  const { rows } = parseLoanStatement(KCB_HEADER + KCB_ROWS);

  it("skips receipt lines and keeps applications", () => {
    expect(rows.map((r) => r.txn_type)).toEqual([
      "stamp_duty",
      "charges",
      "disbursement",
      "interest_due",
      "principal_payment",
      "interest_payment",
      "penalty_interest_due",
      "penalty_payment",
    ]);
  });

  it("takes positive amounts from the payment / money-out columns", () => {
    expect(rows[2]).toMatchObject({ txn_date: "2024-12-23", amount: 3000000 });
    expect(rows[4]).toMatchObject({ txn_date: "2025-01-23", amount: 61905.2 });
    expect(rows[3].statement_balance).toBeCloseTo(3047608.8, 2);
  });

  it("uses the transaction date, not the value date", () => {
    expect(rows[7].txn_date).toBe("2025-05-24");
    expect(rows[7].value_date).toBe("2025-05-23");
  });

  it("summarises totals", () => {
    const s = summariseRows(rows);
    expect(s.disbursed).toBe(3000000);
    expect(s.principalPaid).toBeCloseTo(61905.2, 2);
    expect(s.interestCharged).toBeCloseTo(47652.35, 2);
    expect(s.fees).toBeCloseTo(31647, 2);
  });
});

describe("html table paste", () => {
  it("parses rows pasted as an html table", () => {
    const html = `<table><tr><td>23 JUL 2026</td><td>Interest Due</td><td>23 JUL 2026</td><td>0.00</td><td>0.00</td><td>-23,206.85</td><td>-1,714,659.80</td></tr></table>`;
    const { rows } = parseLoanStatement(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ txn_type: "interest_due", amount: 23206.85, txn_date: "2026-07-23" });
  });
});
