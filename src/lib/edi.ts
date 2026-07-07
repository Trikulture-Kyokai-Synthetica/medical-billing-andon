// Synthetic EDI / HL7 message rendering. Turns a claim (and its remittance)
// into recognizable-but-fabricated healthcare messages, so the demo shows the
// real shape of a revenue cycle:
//
//   HL7 v2 charge (DFT^P03)  ->  X12 837 claim  ->  X12 835 remittance
//
// Everything is synthetic. No PHI, ever — names and IDs are obviously fake.
// The point isn't byte-perfect EDI; it's that a revenue-cycle person recognizes
// the segments and sees where the CARC denial rides in the 835's CAS segment.

import type { Claim } from "./claim";
import type { Remit } from "./payer";
import { carcForField } from "./carc";

const CPT_NAMES: Record<string, string> = {
  "70450": "CT HEAD/BRAIN W/O CONTRAST",
  "72148": "MRI LUMBAR SPINE W/O CONTRAST",
  "73721": "MRI LOWER EXTREMITY JOINT W/O",
  "74177": "CT ABDOMEN & PELVIS W/CONTRAST",
  "71260": "CT THORAX W/CONTRAST",
  "70553": "MRI BRAIN W/O & W/CONTRAST",
};

// A fixed synthetic patient — clearly fake, obviously not PHI.
const FAKE_MRN = "SYN-000-DEMO";
const FAKE_NAME = "DOE^JANE^Q";
const FAKE_NPI = "1999999984"; // synthetic (NPPES test-range style)

/** HL7 v2 segment — pipe-delimited. */
function seg(...fields: (string | number)[]): string {
  return fields.join("|");
}

/** X12 segment — asterisk element separator, tilde segment terminator. */
function x12(...fields: (string | number)[]): string {
  return fields.join("*") + "~";
}

/** HL7 v2.5.1 DFT^P03 — a detailed financial (charge) transaction, the
 *  clinical-system origin of the claim. FT1 carries the charge; DG1 the dx. */
export function hl7Charge(c: Claim): string {
  const cptName = CPT_NAMES[c.cpt] ?? "IMAGING PROCEDURE";
  return [
    seg("MSH", "^~\\&", "RIS", "SIMONMED", "BILLING", "SIMONMED", "20260713101500", "", "DFT^P03", `MSG${c.claimId}`, "P", "2.5.1"),
    seg("EVN", "P03", "20260713101500"),
    seg("PID", 1, "", `${FAKE_MRN}^^^SIMONMED^MR`, "", FAKE_NAME, "", "19700101"),
    seg("FT1", 1, "", "", "20260713", "", "CG", `${c.cpt}^${cptName}^CPT`, "", "", c.units, c.chargeUsd.toFixed(2)),
    seg("DG1", 1, "ICD-10-CM", `${c.dx}^^I10`),
  ].join("\n");
}

/** X12 837P (professional claim) — the outbound claim. CLM = claim level,
 *  HI = diagnosis, SV1 = service line. Modifier/auth presence is reflected. */
export function x837(c: Claim): string {
  const mod = c.modifierPresent ? ":26" : ""; // e.g. professional-component modifier
  const authSeg = c.priorAuthPresent ? x12("REF", "G1", `AUTH${c.claimId.slice(-6)}`) : "REF*G1*<<MISSING AUTH>>~";
  const npiSeg = c.npiPresent ? x12("NM1", "82", 1, "PROVIDER", "R", "", "", "", "XX", FAKE_NPI) : "NM1*82*1*PROVIDER*R*****XX*<<MISSING NPI>>~";
  return [
    x12("ST", "837", "0001", "005010X222A1"),
    x12("CLM", c.claimId, c.chargeUsd.toFixed(2), "", "", "11:B:1", "Y", "A", "Y", "Y"),
    x12("HI", `ABK:${c.dx.replace(/\./g, "")}`),
    npiSeg,
    authSeg,
    x12("SV1", `HC:${c.cpt}${mod}`, c.chargeUsd.toFixed(2), "UN", c.units, "", "", 1),
    x12("SE", "7", "0001"),
  ].join("\n");
}

/** X12 835 remittance — the payer's answer. CLP status 1 = paid, 4 = denied.
 *  On denial, CAS carries the CARC (group*reason*amount). This is the segment
 *  that pulls the andon cord. */
export function x835(c: Claim, remit: Remit): string {
  if (remit.status === "paid") {
    return [
      x12("ST", "835", "0001"),
      x12("CLP", c.claimId, 1, c.chargeUsd.toFixed(2), c.chargeUsd.toFixed(2), 0, "MC"),
      x12("SVC", `HC:${c.cpt}`, c.chargeUsd.toFixed(2), c.chargeUsd.toFixed(2)),
      x12("SE", "4", "0001"),
    ].join("\n");
  }
  const carc = remit.carc!;
  const [group, reason] = carc.code.split("-"); // "CO-11" -> ["CO","11"]
  const rarc = carc.rarc ? x12("LQ", "HE", carc.rarc) : null;
  return [
    x12("ST", "835", "0001"),
    x12("CLP", c.claimId, 4, c.chargeUsd.toFixed(2), "0.00", "0.00", "MC"),
    x12("CAS", group, reason, c.chargeUsd.toFixed(2)), // <-- the denial rides here
    x12("SVC", `HC:${c.cpt}`, c.chargeUsd.toFixed(2), "0.00"),
    ...(rarc ? [rarc] : []),
    x12("SE", "6", "0001"),
  ].join("\n");
}

export interface ClaimMessages {
  hl7: string;
  x837: string;
  x835: string | null; // null until adjudicated
}

export function messagesFor(c: Claim, remit: Remit | null): ClaimMessages {
  return {
    hl7: hl7Charge(c),
    x837: x837(c),
    x835: remit ? x835(c, remit) : null,
  };
}
