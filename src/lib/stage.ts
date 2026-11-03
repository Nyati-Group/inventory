// Maps workflow state to the stepper index: RFQ → Quotes → Compare → Approve → PO → Delivery → GRN → Rated.

export function rfqStage(status: string, responded: number) {
  switch (status) {
    case "DRAFT":
      return 0;
    case "SENT":
      return responded ? 1 : 0;
    case "PARTIALLY_RESPONDED":
      return 1;
    case "CLOSED":
      return 2;
    case "AWAITING_APPROVAL":
      return 3;
    case "APPROVED":
    case "ORDERED":
      return 4;
    default:
      return 0;
  }
}

/** 8 = every step done (closed and rated). */
export function poStage(po: { status: string; rated: boolean }) {
  switch (po.status) {
    case "DRAFT":
    case "APPROVED":
      return 4;
    case "SENT":
    case "ACCEPTED":
    case "CHANGE_REQUESTED":
      return 5;
    case "PARTIALLY_DELIVERED":
      return 6;
    case "DELIVERED":
      return 7;
    case "CLOSED":
      return po.rated ? 8 : 7;
    default:
      return 4;
  }
}
