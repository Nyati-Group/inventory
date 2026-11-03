import { Prisma } from "@prisma/client";
import { db } from "./db";

async function next(key: string, tx: Prisma.TransactionClient = db) {
  const c = await tx.counter.upsert({ where: { key }, create: { key, value: 1 }, update: { value: { increment: 1 } } });
  return c.value;
}

const year = () => new Date().getFullYear();
const pad = (n: number, w = 4) => String(n).padStart(w, "0");

/** RFQ-<PROJ>-<YYYY>-<seq> */
export async function nextRfqNumber(projectCode: string, tx?: Prisma.TransactionClient) {
  const y = year();
  return `RFQ-${projectCode}-${y}-${pad(await next(`RFQ:${projectCode}:${y}`, tx))}`;
}
export async function nextPoNumber(projectCode: string, tx?: Prisma.TransactionClient) {
  const y = year();
  return `PO-${projectCode}-${y}-${pad(await next(`PO:${projectCode}:${y}`, tx))}`;
}
export async function nextGrnNumber(projectCode: string, tx?: Prisma.TransactionClient) {
  const y = year();
  return `GRN-${projectCode}-${y}-${pad(await next(`GRN:${projectCode}:${y}`, tx))}`;
}
export async function nextQuotationRef(tx?: Prisma.TransactionClient) {
  const y = year();
  return `QT-${y}-${pad(await next(`QT:${y}`, tx), 5)}`;
}
