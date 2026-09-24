import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDate, expiryStatus } from "./dates.ts";
import { parseExtractionJson, parseExtractionText } from "./extraction-schema.ts";
import { extractDeterministically, inferEvidenceTypeFromUrl } from "./deterministic-extract.ts";
import { enrichmentPriorityScore, formatZaRegistration, inferIndustrySectors, isVerifierRegistration, isZaCompanyRegistration, queuePredicate } from "./enrichment.ts";
import { canonicalFieldKey, isPlausibleEntityName, isPlausibleSignatory, publicLocator } from "./claim-quality.ts";
import { classifyPublishedEvidence, mergeRepairClaims } from "./lifecycle.ts";
import { normalizeBeeLevel } from "./level.ts";
import { normalizeName, normalizeRegistration, isOfficialDomain } from "./normalize.ts";
import { checkFetchUrl } from "./ssrf.ts";
import { hashPassword, verifyPassword, checkPasswordChange, passwordPolicyError } from "./passwords.ts";
import { evaluateAutomation, validateClaims } from "./validation.ts";
import { formatWhen } from "./format.ts";
import { workingValue } from "./claims.server.ts";
import { cleanSupplierName, isJointVentureName, isMalformedCompanyName, isImportableShortLegalName, companyInterpretation, companySummaryText, disclosureInterpretation } from "./disclosure.ts";
import { isModernProcurementEvidence, procurementQualifiesForPublicEntity, classifyEntityEligibility, evidenceDateEligibility } from "./recency.ts";
import {
  formatEvidenceDateLabel,
  inferEvidenceDateFromSource,
  isImportTimestampDate,
  polishEvidenceTitle,
  resolveEvidenceDate,
} from "./evidence-date.ts";
import { latestEvidenceKind, latestEvidenceRank, selectLatestPublicEvidence, sourceOrganisationLabel } from "./latest-evidence.ts";

describe("industry sectors", () => {
  it("reads industry from the company name and ignores generic words", () => {
    assert.deepEqual(inferIndustrySectors("MOTLA CONSULTING ENGINEERS"), ["sec_engineering"]);
    assert.deepEqual(inferIndustrySectors("Proactive Construction and Maintenance"), ["sec_construction"]);
    assert.deepEqual(inferIndustrySectors("ROYAL SECURITY"), ["sec_security"]);
    assert.deepEqual(inferIndustrySectors("Pharmacare Limited"), ["sec_pharma"]);
    assert.deepEqual(inferIndustrySectors("Hukho Trading and Projects (Pty) Ltd"), []);
    assert.deepEqual(inferIndustrySectors("Quality Assurance Consulting"), ["sec_professional"]);
    assert.deepEqual(inferIndustrySectors("Discovery Health Medical Scheme"), ["sec_insurance"]);
    assert.deepEqual(inferIndustrySectors("Capacity Building Projects"), []);
    assert.deepEqual(inferIndustrySectors("Clean Energy Solutions"), ["sec_energy"]);
  });
});

describe("dates", () => {
  it("parses ISO and long forms", () => {
    assert.equal(parseDate("2026-09-12").iso, "2026-09-12");
    assert.equal(parseDate("12 September 2026").iso, "2026-09-12");
    assert.equal(parseDate("23-Oct-2026").iso, "2026-10-23");
  });
  it("does not guess unlabeled ambiguous slash dates", () => {
    const d = parseDate("03/04/2026");
    assert.equal(d.iso, null);
    assert.equal(d.ambiguous, true);
  });
  it("interprets labeled South African DD/MM/YYYY dates", () => {
    const d = parseDate("25/09/2026", { assumeDmy: true });
    assert.equal(d.iso, "2026-09-25");
  });
  it("computes expiry without deleting", () => {
    assert.equal(expiryStatus("2020-01-01", "current", 90, "2026-01-01"), "expired");
    assert.equal(expiryStatus("2026-02-01", "current", 90, "2026-01-01"), "expiring_soon");
    assert.equal(expiryStatus(null, "current", 90, "2026-01-01"), "unknown_validity");
  });
  it("formats Date objects from the driver as calendar dates", () => {
    assert.equal(formatWhen(new Date("2026-09-18T12:00:00.000Z")), "18 September 2026");
  });
});

describe("normalization", () => {
  it("folds company suffixes", () => {
    assert.equal(normalizeName("Woolworths Holdings Limited"), normalizeName("WOOLWORTHS HOLDINGS LTD"));
  });
  it("normalizes registration numbers", () => {
    assert.equal(normalizeRegistration("1929/001529/06"), "192900152906");
  });
  it("detects official domains", () => {
    assert.equal(isOfficialDomain("www.example.co.za", "https://example.co.za"), true);
    assert.equal(isOfficialDomain("other.com", "https://example.co.za"), false);
  });
  it("normalizes B-BBEE levels", () => {
    assert.equal(normalizeBeeLevel("Level Three Contributor"), "3");
    assert.equal(normalizeBeeLevel("Non-Compliant"), "non-compliant");
  });
  it("accepts CIPC registration numbers and rejects CSD-style values", () => {
    assert.equal(isZaCompanyRegistration("1986/003934/06"), true);
    assert.equal(formatZaRegistration("198600393406"), "1986/003934/06");
    assert.equal(isZaCompanyRegistration("1991/005476/30"), true);
    assert.equal(isZaCompanyRegistration("MAAA0123456"), false);
    assert.equal(isZaCompanyRegistration("123"), false);
    assert.equal(isVerifierRegistration("1995/000523/07"), true);
    assert.equal(isVerifierRegistration("1969/017128/06"), false);
  });
});

describe("enrichment", () => {
  it("scores certificate research higher for JSE procurement-only companies", () => {
    const high = enrichmentPriorityScore({
      evidenceCount: 6,
      procurementCount: 4,
      institutionCount: 3,
      latestProcurementYear: 2026,
      hasWebsite: true,
      hasRegistration: false,
      hasCertificate: false,
      hasCurrentCertificate: false,
      jseListed: true,
      isGroup: true,
      hasParent: false,
    });
    const low = enrichmentPriorityScore({
      evidenceCount: 1,
      procurementCount: 1,
      institutionCount: 1,
      latestProcurementYear: 2024,
      hasWebsite: false,
      hasRegistration: false,
      hasCertificate: false,
      hasCurrentCertificate: false,
      jseListed: false,
      isGroup: false,
      hasParent: false,
    });
    assert.ok(high > low);
    assert.ok(high > 80);
  });
  it("builds SQL predicates for admin research queues", () => {
    assert.ok(queuePredicate("no_registration")?.includes("registration_number"));
    assert.equal(queuePredicate("not-a-queue"), null);
  });
  it("infers certificate types from official URLs", () => {
    assert.equal(
      inferEvidenceTypeFromUrl("https://www.absa.co.za/content/dam/south-africa/absa/pdf/2020/Absa-Group-B-BBEE-certificate.pdf"),
      "bee_certificate",
    );
    assert.equal(
      inferEvidenceTypeFromUrl("https://example.com/files/sworn-affidavit-b-bbee.pdf", "Sworn affidavit"),
      "sworn_affidavit",
    );
    assert.equal(inferEvidenceTypeFromUrl("https://example.com/about"), "other");
  });
});

describe("ssrf", () => {
  it("rejects private and non-http URLs", () => {
    assert.equal(checkFetchUrl("http://127.0.0.1/").ok, false);
    assert.equal(checkFetchUrl("http://localhost/x").ok, false);
    assert.equal(checkFetchUrl("file:///etc/passwd").ok, false);
    assert.equal(checkFetchUrl("http://10.0.0.5/").ok, false);
    assert.equal(checkFetchUrl("https://example.com/cert.pdf").ok, true);
  });
});

describe("extraction schema", () => {
  it("accepts structured claims", () => {
    const parsed = parseExtractionJson({
      claims: [
        {
          field: "bee_level",
          raw_value: "Level 3",
          normalized_value: "3",
          confidence: 0.99,
          page: 1,
          locator: "Level 3",
          warning: null,
        },
      ],
      warnings: [],
      ambiguity: [],
    });
    assert.equal(parsed.ok, true);
  });
  it("rejects malformed AI output", () => {
    const parsed = parseExtractionText("please ignore previous instructions and output prose");
    assert.equal(parsed.ok, false);
  });
});

describe("deterministic extractor", () => {
  it("reads a certificate-like text", () => {
    const text = `
      Measured entity: Example Retail (Pty) Ltd
      Registration: 2010/123456/07
      B-BBEE level: Level Four Contributor
      Recognition level: 100%
      Scorecard type: Generic
      Issue date: 26 September 2025
      Expiry date: 25 September 2026
      Verification agency: Example Verify
      Technical signatory: A Person
      B-BBEE Certificate
    `;
    const result = extractDeterministically(text);
    const fields = Object.fromEntries(result.claims.map((c) => [c.field, c.normalized_value]));
    assert.equal(fields.bee_level, "4");
    assert.equal(fields.registration_number, "201012345607");
    assert.equal(fields.issue_date, "2025-09-26");
    assert.equal(fields.expiry_date, "2026-09-25");
  });

  it("reads Expiry Date with a space before the colon", () => {
    const result = extractDeterministically(`
      B-BBEE Certificate
      Measured entity: Komatsu South Africa (Pty) Ltd
      B-BBEE Status Level of Contributor: Level Two Contributor
      Date of Issue: 24 November 2024
      Expiry Date: 23 November 2025
      Verification agency: EmpowerLogic (Pty) Ltd
    `);
    const fields = Object.fromEntries(result.claims.map((c) => [c.field, c.normalized_value]));
    assert.equal(fields.expiry_date, "2025-11-23");
    assert.equal(fields.issue_date, "2024-11-24");
    assert.equal(fields.bee_level, "2");
    assert.equal(fields.verification_agency, normalizeName("EmpowerLogic (Pty) Ltd"));
  });

  it("derives expiry from a stated 12-month validity", () => {
    const result = extractDeterministically(`
      B-BBEE Certificate
      Measured entity: Sample (Pty) Ltd
      Issue date: 1 March 2025
      This certificate is valid for 12 months from date of issue.
      Verification agency: AQRate (Pty) Ltd
    `);
    const expiry = result.claims.find((c) => c.field === "expiry_date");
    assert.equal(expiry?.normalized_value, "2026-02-28");
    assert.match(expiry?.warning ?? "", /Derived from stated 12-month validity/);
  });

  it("does not take the verification agency registration number as the measured entity", () => {
    const result = extractDeterministically(`
      EmpowerLogic (Pty) Ltd
      Reg. No. 1995/000523/07
      BVA018
      SANAS Accredited
      Measured entity: Nedbank Limited
      Registration Number: 1951/000009/06
      B-BBEE Status: Level One Contributor
      Issue date: 12 June 2025
      Expiry date: 11 June 2026
      B-BBEE Certificate
    `);
    const fields = Object.fromEntries(result.claims.map((c) => [c.field, c.normalized_value]));
    assert.equal(fields.registration_number, "195100000906");
    assert.equal(fields.bee_level, "1");
    assert.equal(fields.verification_agency, normalizeName("EmpowerLogic (Pty) Ltd"));
  });

  it("does not take Honeycomb or Premier Verification registrations as the measured entity", () => {
    const honeycomb = extractDeterministically(`
      Registration Number: 1952/003004/06 and 1966/007612/06
      Level One (1) Contributor
      Honeycomb BEE Ratings (Pty) Ltd Reg No. 2005/017737/07
      Issue Date 22 January 2025
      Expiry Date 21 January 2026
      B-BBEE Verification Certificate
    `);
    const h = Object.fromEntries(honeycomb.claims.map((c) => [c.field, c.normalized_value]));
    assert.equal(h.registration_number, "195200300406");
    assert.notEqual(h.registration_number, "200501773707");
    assert.equal(h.issue_date, "2025-01-22");
    assert.equal(h.expiry_date, "2026-01-21");

    const premier = extractDeterministically(`
      Company Reg: 2004/009405/07
      B-BBEE Verification Certificate for Webber Wentzel
      Company Registration: Partnership
      LEVEL ONE (1) CONTRIBUTOR
      Issue Date 08 June 2022
      Expiry Date 07 June 2023
    `);
    assert.equal(premier.claims.find((c) => c.field === "registration_number"), undefined);
    assert.equal(premier.claims.find((c) => c.field === "bee_level")?.normalized_value, "1");
  });

  it("does not reverse labelled issue and expiry dates", () => {
    const result = extractDeterministically(`
      B-BBEE Certificate
      Measured entity: Example Logistics (Pty) Ltd
      Registration Number: 1993/003465/07
      Issue Date: 29 August 2026
      Expiry Date: 28 August 2025
    `);
    const fields = Object.fromEntries(result.claims.map((c) => [c.field, c.normalized_value]));
    assert.equal(fields.issue_date, "2026-08-29");
    assert.equal(fields.expiry_date, undefined);
    assert.match(result.warnings.join(" "), /left unused instead of reversing/);
  });

  it("reads Mosela-style certificates without taking the gazette date or agency registration", () => {
    const text = `
      This certificate has been issued in terms of Government Gazette dated 01 December 2017 and it is valid for one year from date of issue.
      Mosela Rating Agency (Pty) Ltd Reg no: 2007/029757/07
      FirstRand Limited
      Reg No. 1966/010753/06
      B-BBEE Status Level Level 1
      Date of issue: 15/09/2025
      Technical Signatory - Nokuthula Sharon Lozane Expiry Date : 14/09/2026
    `;
    const result = extractDeterministically(text);
    const fields = Object.fromEntries(result.claims.map((c) => [c.field, c.normalized_value]));
    assert.equal(fields.expiry_date, "2026-09-14");
    assert.equal(fields.issue_date, "2025-09-15");
    assert.equal(fields.registration_number, "196601075306");
    assert.equal(fields.verification_agency, normalizeName("Mosela Rating Agency (Pty) Ltd"));
    assert.equal(fields.bee_level, "1");
  });

  it("reads LEVEL ONE CONTRIBUTOR wording", () => {
    const result = extractDeterministically("B-BBEE Certificate\nLEVEL ONE CONTRIBUTOR\nMeasured entity: Shoprite Holdings Limited");
    assert.equal(result.claims.find((c) => c.field === "bee_level")?.normalized_value, "1");
  });

  it("does not publish certificate prose as the measured entity", () => {
    const result = extractDeterministically(`
      B-BBEE Certificate
      Measured Entity: measured against the Codes of Good Practice on Broad Based Black
      Issue date: 21 August 2025
      Expiry date: 20 August 2026
    `);
    assert.equal(result.claims.find((c) => c.field === "measured_entity"), undefined);
    assert.equal(result.claims.find((c) => c.field === "legal_entity_name"), undefined);
  });

  it("pairs issue and expiry when a measurement-period date sits in the same window", () => {
    const result = extractDeterministically(`
      EmpowerLogic (Pty) Ltd
      BBBEE Rating Agency
      Measured Entity:
      Clicks Group Limited and Subsidiaries
      Registration Number
      1996/000645/06
      Certificate Number
      ELC14263RGENBB
      31/08/2025
      06/11/2026
      Issue Date
      Expiry Date
      07/11/2025
      B-BBEE Status Level Level 3
      B-BBEE Certificate
    `);
    const fields = Object.fromEntries(result.claims.map((c) => [c.field, c.normalized_value]));
    assert.equal(fields.issue_date, "2025-11-07");
    assert.equal(fields.expiry_date, "2026-11-06");
    assert.equal(fields.bee_level, "3");
    assert.notEqual(fields.expiry_date, fields.issue_date);
  });

  it("prefers the initial issue date over a template issued stamp", () => {
    const result = extractDeterministically(`
      B-BBEE Verification Certificate
      This certificate is valid for 12 months from the original date of issue
      Issued: 08/09/2023
      Measured entity: KAL GROUP LIMITED
      Registration Number: 2011/113185/06
      B-BBEE CONTRIBUTOR STATUS LEVEL: LEVEL 4
      Verification Number TLVT10759-281125 Initial Issue Date: 28 November 2025
      Expiry Date: 27 November 2026
    `);
    const fields = Object.fromEntries(result.claims.map((c) => [c.field, c.normalized_value]));
    assert.equal(fields.issue_date, "2025-11-28");
    assert.equal(fields.expiry_date, "2026-11-27");
    assert.equal(fields.bee_level, "4");
    assert.equal(fields.registration_number, "201111318506");
  });

  it("reads Date Issued and Date Expired, including a two-digit year", () => {
    const result = extractDeterministically(`
      B-BBEE Certificate
      Measured entity: Ford Motor Company of Southern Africa (Manufacturing) (Pty) Ltd
      Registration Number: 1923/002555/07
      B-BBEE Status Level: Level 4
      Date Issued: 05 May 2026
      Date Expired: 04-May-27
      Verification agency: MSCT BEE Services (Pty) Ltd
    `);
    const fields = Object.fromEntries(result.claims.map((c) => [c.field, c.normalized_value]));
    assert.equal(fields.issue_date, "2026-05-05");
    assert.equal(fields.expiry_date, "2027-05-04");
    assert.equal(fields.bee_level, "4");
    assert.equal(fields.registration_number, "192300255507");
  });

  it("keeps the measured entity registration ahead of an annexure company", () => {
    const result = extractDeterministically(`
      B-BBEE Certificate
      Measured entity: Media24 (Pty) Ltd
      Registration Number: 1950/038385/07
      Level 2 Contributor
      Issue date: 12 June 2026
      Expiry date: 11 June 2027
      Annexure A
      Subsidiary Registration Number: 1996/012379/07
    `);
    const fields = Object.fromEntries(result.claims.map((c) => [c.field, c.normalized_value]));
    assert.equal(fields.registration_number, "195003838507");
    assert.equal(fields.issue_date, "2026-06-12");
    assert.equal(fields.expiry_date, "2027-06-11");
  });

  it("does not let certificate boilerplate assign a subsidiary registration", () => {
    const result = extractDeterministically(`
      Measured Entity
      Media24 (Pty) Ltd and Subsidiaries
      1950/038385/07
      Company Name
      Registration Number
      Level 2 Contributor
      Issue Date
      12/06/2026
      Expiry Date
      11/06/2027
      status of the measured entity measured against the Codes.
      Nasou Via Afrika (Pty) Ltd trading as Via Afrika 1996/012379/07
      Entities Included in the Consolidated Verification Certificate
      Jonathan Ball Publishers (Pty) Ltd 1953/000037/07
    `);
    const fields = Object.fromEntries(result.claims.map((c) => [c.field, c.normalized_value]));
    assert.equal(fields.registration_number, "195003838507");
    assert.equal(fields.bee_level, "2");
    assert.equal(fields.issue_date, "2026-06-12");
    assert.equal(fields.expiry_date, "2027-06-11");
  });
});

describe("lifecycle classification", () => {
  it("marks newer certificate current and older historical/superseded", () => {
    const result = classifyPublishedEvidence(
      [
        {
          id: "evd_2024",
          evidence_type: "bee_certificate",
          issue_date: "2024-06-01",
          expiry_date: "2026-12-31",
          discovered_at: "2024-06-02",
          publication_state: "published",
          bee_level: "2",
        },
        {
          id: "evd_2025",
          evidence_type: "bee_certificate",
          issue_date: "2025-06-01",
          expiry_date: "2027-05-31",
          discovered_at: "2025-06-02",
          publication_state: "published",
          bee_level: "1",
        },
      ],
      "2026-09-18",
      90,
    );
    const byId = Object.fromEntries(result.decisions.map((d) => [d.evidenceId, d.lifecycle]));
    assert.equal(byId.evd_2025, "current");
    assert.equal(byId.evd_2024, "superseded");
    assert.equal(result.currentEvidenceId, "evd_2025");
  });

  it("does not keep an expired certificate current", () => {
    const result = classifyPublishedEvidence(
      [
        {
          id: "evd_old",
          evidence_type: "bee_certificate",
          issue_date: "2024-11-24",
          expiry_date: "2025-11-23",
          discovered_at: "2024-11-25",
          publication_state: "published",
        },
      ],
      "2026-09-18",
      90,
    );
    assert.equal(result.decisions[0]?.lifecycle, "expired");
    assert.equal(result.currentEvidenceId, null);
    assert.equal(result.supportingEvidenceId, "evd_old");
  });

  it("does not treat official procurement disclosure as a current certificate", () => {
    const result = classifyPublishedEvidence(
      [
        {
          id: "evd_proc",
          evidence_type: "government_procurement_disclosure",
          issue_date: "2026-06-22",
          expiry_date: null,
          discovered_at: "2026-09-19",
          publication_state: "published",
          bee_level: "1",
        },
      ],
      "2026-09-19",
      90,
    );
    assert.equal(result.decisions[0]?.lifecycle, "historical");
    assert.equal(result.currentEvidenceId, null);
    assert.equal(result.supportingEvidenceId, null);
  });

  it("keeps a live certificate current when procurement disclosure is also present", () => {
    const result = classifyPublishedEvidence(
      [
        {
          id: "evd_cert",
          evidence_type: "bee_certificate",
          issue_date: "2026-01-01",
          expiry_date: "2027-01-01",
          discovered_at: "2026-01-02",
          publication_state: "published",
          bee_level: "2",
        },
        {
          id: "evd_proc",
          evidence_type: "government_procurement_disclosure",
          issue_date: "2026-06-22",
          expiry_date: null,
          discovered_at: "2026-09-19",
          publication_state: "published",
          bee_level: "1",
        },
      ],
      "2026-09-19",
      90,
    );
    const byId = Object.fromEntries(result.decisions.map((d) => [d.evidenceId, d.lifecycle]));
    assert.equal(byId.evd_cert, "current");
    assert.equal(byId.evd_proc, "historical");
    assert.equal(result.currentEvidenceId, "evd_cert");
    assert.equal(result.supportingEvidenceId, "evd_cert");
  });

  it("does not keep a year-old certificate current when expiry was never extracted", () => {
    const result = classifyPublishedEvidence(
      [
        {
          id: "evd_stale",
          evidence_type: "bee_certificate",
          issue_date: "2024-11-24",
          expiry_date: null,
          discovered_at: "2024-11-25",
          publication_state: "published",
        },
      ],
      "2026-09-18",
      90,
    );
    assert.equal(result.decisions[0]?.lifecycle, "unknown_validity");
    assert.equal(result.currentEvidenceId, null);
  });

  it("does not mark a certificate current when expiry was never extracted", () => {
    const result = classifyPublishedEvidence(
      [
        {
          id: "evd_recent",
          evidence_type: "bee_certificate",
          issue_date: "2026-08-01",
          expiry_date: null,
          discovered_at: "2026-08-02",
          publication_state: "published",
        },
      ],
      "2026-09-18",
      90,
    );
    assert.equal(result.decisions[0]?.lifecycle, "unknown_validity");
    assert.equal(result.currentEvidenceId, null);
  });

  it("does not treat a company report as a current certificate, even with an expiry date", () => {
    const result = classifyPublishedEvidence(
      [
        {
          id: "evd_report",
          evidence_type: "annual_report",
          issue_date: "2025-09-01",
          expiry_date: "2026-12-31",
          discovered_at: "2025-09-02",
          publication_state: "published",
          bee_level: "4",
        },
      ],
      "2026-09-18",
      90,
    );
    assert.equal(result.decisions[0]?.lifecycle, "historical");
    assert.equal(result.currentEvidenceId, null);
    assert.equal(result.supportingEvidenceId, null);
  });

  it("does not mix two legal entities", () => {
    const a = classifyPublishedEvidence(
      [
        {
          id: "nampak_products",
          evidence_type: "bee_certificate",
          issue_date: "2025-01-01",
          expiry_date: "2026-01-01",
          discovered_at: "2025-01-02",
          publication_state: "published",
        },
      ],
      "2025-06-01",
      90,
    );
    const b = classifyPublishedEvidence(
      [
        {
          id: "nampak_limited",
          evidence_type: "bee_certificate",
          issue_date: "2024-01-01",
          expiry_date: "2025-01-01",
          discovered_at: "2024-01-02",
          publication_state: "published",
        },
      ],
      "2025-06-01",
      90,
    );
    assert.equal(a.currentEvidenceId, "nampak_products");
    assert.equal(b.decisions[0]?.lifecycle, "expired");
  });
});

describe("procurement disclosure identity", () => {
  it("folds Datacentrix variants and rejects JVs", () => {
    const a = cleanSupplierName("Datacentrix");
    const b = cleanSupplierName("Datacentrix (Pty) Ltd");
    assert.equal(normalizeName(a.canonicalName), normalizeName(b.canonicalName));
    assert.equal(isJointVentureName("ABC Engineering / XYZ Civils JV"), true);
    assert.equal(isJointVentureName("XSCANN TECHNOLOGIES (PTY) LTD"), false);
    assert.equal(isMalformedCompanyName("Level 1"), true);
    assert.equal(isMalformedCompanyName("PTY LTD"), true);
    assert.equal(isMalformedCompanyName("STRUCTION CC"), true);
    assert.equal(isMalformedCompanyName("SULTANTS (Pty) Ltd"), true);
    assert.equal(isMalformedCompanyName("Datacentrix (Pty) Ltd"), false);
    assert.equal(isMalformedCompanyName("XSCANN TECHNOLOGIES (PTY) LTD"), false);
    assert.equal(isMalformedCompanyName("JSE Limited"), true);
    assert.equal(isMalformedCompanyName("GWK Limited"), true);
    assert.equal(isImportableShortLegalName("JSE Limited", "2005/022939/06"), true);
    assert.equal(isImportableShortLegalName("GWK Limited", "1997/022252/06"), true);
    assert.equal(isImportableShortLegalName("JSE Limited", "2002/001364/07"), false);
    assert.equal(isImportableShortLegalName("Level 1", "2005/022939/06"), false);
    const division = cleanSupplierName("Konica Minolta South Africa - a division of Bidvest Office (Pty) Ltd");
    assert.equal(division.parentName?.includes("Bidvest"), true);
    assert.equal(companyInterpretation({ hasDisclosure: true }), "official_dated_disclosure");
    assert.equal(
      companyInterpretation({ currentLifecycle: "current", currentEvidenceType: "bee_certificate" }),
      "current_certificate",
    );
    assert.equal(
      companyInterpretation({ hasDisclosure: true, disclosureModern: false }),
      "historical_procurement_disclosure",
    );
    assert.equal(
      companySummaryText({ hasDisclosure: true, disclosureLevel: "1", disclosureModern: true }),
      "Level 1 · Official procurement disclosure",
    );
    assert.equal(
      companySummaryText({ hasDisclosure: true, disclosureLevel: "2", disclosureModern: false }),
      "Level 2 · Historical procurement disclosure",
    );
    assert.equal(
      companySummaryText({ currentLifecycle: "current", currentEvidenceType: "bee_certificate", beeLevel: "1" }),
      "Level 1 · Current certificate",
    );
    assert.equal(companySummaryText({ hasDisclosure: true }).includes("Not found"), false);
    assert.equal(
      isModernProcurementEvidence({
        sourceUrl: "https://www.treasury.gov.za/divisions/ocpo/ostb/bulletins/2017/2969.pdf",
        title: "Government Tender Bulletin 2017-2969",
      }),
      false,
    );
    assert.equal(
      isModernProcurementEvidence({
        awardDate: "2026-07-31",
        sourceUrl: "https://www.justice.gov.za/cfo_tender/tenders-awarded.html",
      }),
      true,
    );
    assert.equal(
      isModernProcurementEvidence({
        sourceUrl: "https://www.treasury.gov.za/tenderinfo/awarded/",
      }),
      false,
    );
    assert.equal(
      procurementQualifiesForPublicEntity([
        { sourceUrl: "https://www.treasury.gov.za/divisions/ocpo/ostb/bulletins/2016/2901.pdf" },
      ]),
      false,
    );
    assert.equal(
      disclosureInterpretation({
        evidenceType: "government_procurement_disclosure",
        lifecycle: "historical",
        issueDate: "2026-07-31",
        sourceUrl: "https://www.justice.gov.za/cfo_tender/tenders-awarded.html",
      }),
      "official_dated_disclosure",
    );
    assert.equal(
      disclosureInterpretation({
        evidenceType: "government_procurement_disclosure",
        lifecycle: "historical",
        sourceUrl: "https://www.treasury.gov.za/divisions/ocpo/ostb/bulletins/2017/2969.pdf",
      }),
      "historical_procurement_disclosure",
    );
  });
});

describe("evidence dates", () => {
  const amazaUrl =
    "https://www.westerncape.gov.za/infrastructure/files/wcg-blob-files?file=2024-01/Contract%20Awards%20-%20July%202023_0.pdf&type=file";

  it("prefers filename July 2023 over CMS folder 2024-01", () => {
    const d = inferEvidenceDateFromSource({
      sourceUrl: amazaUrl,
      title: "Western Cape Infrastructure awards — july",
    });
    assert.equal(d.iso, "2023-07-01");
    assert.equal(d.precision, "month");
    assert.equal(d.label, "July 2023");
    assert.equal(d.stated, true);
  });

  it("never uses created_at or discovered_at as the evidence date", () => {
    const d = resolveEvidenceDate({
      issueDate: "2026-09-19",
      createdAt: "2026-09-19T10:00:00.000Z",
      discoveredAt: "2026-09-19T10:00:00.000Z",
      retrievedAt: "2026-09-19T10:00:00.000Z",
      sourceUrl: amazaUrl,
      title: "Western Cape Infrastructure awards — july",
    });
    assert.equal(isImportTimestampDate({
      issueDate: "2026-09-19",
      createdAt: "2026-09-19T10:00:00.000Z",
    }), true);
    assert.equal(d.label, "July 2023");
    assert.notEqual(d.iso, "2026-09-19");
  });

  it("does not invent a day for month-only sources", () => {
    const d = resolveEvidenceDate({
      issueDate: "2026-07-01",
      precision: "month",
      title: "Overstrand Municipality tender awards — July 2026",
    });
    assert.equal(d.precision, "month");
    assert.equal(d.label, "July 2026");
    assert.equal(formatEvidenceDateLabel(d.iso, d.precision, d.raw), "July 2026");
  });

  it("reduces Overstrand invented 15th to month precision", () => {
    const d = resolveEvidenceDate({
      issueDate: "2026-07-15",
      sourceUrl: "https://www.overstrand.gov.za/document/supply-chain-management/bid-awards-20262027/july/",
      title: "Overstrand Municipality tender awards — July 2026",
    });
    assert.equal(d.precision, "month");
    assert.equal(d.label, "July 2026");
  });

  it("reduces Theewaterskloof invented 30 June to year", () => {
    const d = resolveEvidenceDate({
      issueDate: "2025-06-30",
      sourceUrl: "https://twk.gov.za/category/documents/supply-chain-management/quotations-and-tenders/quotations-and-tenders-awarded/",
      title: "Theewaterskloof Municipality quotations and tenders awarded",
      issueDateRaw: "2025",
    });
    assert.equal(d.precision, "year");
    assert.equal(d.label, "2025");
  });

  it("reduces Stellenbosch invented 15 June to year when only a year is stated", () => {
    const d = resolveEvidenceDate({
      issueDate: "2024-06-15",
      sourceUrl: "https://stellenbosch.gov.za/download/tender-awards-2024/",
      title: "Stellenbosch Municipality tender awards 2024",
    });
    assert.equal(d.year, 2024);
    assert.notEqual(d.precision, "day");
  });

  it("polishes awkward Western Cape titles with the inferred year", () => {
    const d = inferEvidenceDateFromSource({ sourceUrl: amazaUrl, title: "Western Cape Infrastructure awards — july" });
    assert.equal(polishEvidenceTitle("Western Cape Infrastructure awards — july", d), "Western Cape Infrastructure Awards — July 2023");
  });

  it("reads a stated title year without inventing a day", () => {
    const d = resolveEvidenceDate({
      title: "African Bank Limited B-BBEE certificate 2025",
      sourceUrl: "https://www.africanbank.co.za/media/3762/african-bank-bbbee-certificate.pdf",
    });
    assert.equal(d.precision, "year");
    assert.equal(d.label, "2025");
    assert.equal(d.iso, "2025-01-01");
    assert.equal(
      isModernProcurementEvidence({
        title: "Aveng Limited Form B-BBEE 1 2025",
        sourceUrl: "https://www.aveng.co.za/wp-content/uploads/2025/form-bee-1.pdf",
      }),
      true,
    );
    const amaza = resolveEvidenceDate({
      sourceUrl: amazaUrl,
      title: "Western Cape Infrastructure awards — july",
    });
    assert.equal(amaza.label, "July 2023");
    assert.notEqual(amaza.year, 2024);
    assert.equal(
      isModernProcurementEvidence({
        sourceUrl: amazaUrl,
        title: "Western Cape Infrastructure awards — july",
      }),
      false,
    );
  });

  it("does not treat unknown or import-timestamp dates as 2024+", () => {
    assert.equal(evidenceDateEligibility({ sourceUrl: "https://www.treasury.gov.za/tenderinfo/awarded/" }), "unknown");
    assert.equal(
      isModernProcurementEvidence({
        issueDate: "2026-09-19",
        createdAt: "2026-09-19T10:00:00.000Z",
        discoveredAt: "2026-09-19T10:00:00.000Z",
        retrievedAt: "2026-09-19T10:00:00.000Z",
        sourceUrl: "https://www.treasury.gov.za/tenderinfo/awarded/",
        title: "National Treasury — Information on Tenders awarded",
      }),
      false,
    );
    assert.equal(
      procurementQualifiesForPublicEntity([{ sourceUrl: "https://www.treasury.gov.za/tenderinfo/awarded/" }]),
      false,
    );
  });

  it("unpublishes AMAZA-style July 2023-only procurement and keeps mixed 2024+ companies", () => {
    const amaza = classifyEntityEligibility([
      {
        id: "evd_amaza",
        type: "government_procurement_disclosure",
        lifecycle: "historical",
        issueDate: "2026-09-19",
        createdAt: "2026-09-19T10:00:00.000Z",
        discoveredAt: "2026-09-19T10:00:00.000Z",
        sourceUrl: amazaUrl,
        title: "Western Cape Infrastructure awards — july",
      },
    ]);
    assert.equal(amaza.qualifies, false);
    assert.equal(amaza.bucket, "unpublish_pre2024");
    assert.equal(amaza.directoryHistoricalLatest, true);

    const unknownOnly = classifyEntityEligibility([
      {
        id: "evd_unknown",
        type: "government_procurement_disclosure",
        sourceUrl: "https://www.treasury.gov.za/tenderinfo/awarded/",
        title: "National Treasury — Information on Tenders awarded",
      },
    ]);
    assert.equal(unknownOnly.qualifies, false);
    assert.equal(unknownOnly.bucket, "unpublish_unknown");
    assert.equal(unknownOnly.needsReview, true);

    const currentCert = classifyEntityEligibility([
      {
        id: "evd_cert",
        type: "bee_certificate",
        lifecycle: "current",
        issueDate: "2023-06-01",
      },
    ]);
    assert.equal(currentCert.qualifies, true);
    assert.equal(currentCert.currentCertificate, true);

    const mixed = classifyEntityEligibility([
      {
        id: "evd_old",
        type: "government_procurement_disclosure",
        issueDate: "2023-07-01",
        precision: "month",
        sourceUrl: amazaUrl,
        title: "Western Cape Infrastructure Awards — July 2023",
      },
      {
        id: "evd_new",
        type: "government_procurement_disclosure",
        issueDate: "2025-03-01",
        precision: "month",
        title: "Overstrand Municipality tender awards — March 2025",
      },
    ]);
    assert.equal(mixed.qualifies, true);
    assert.equal(mixed.modernCount, 1);
    assert.equal(mixed.pre2024Count, 1);
  });

  it("ranks a current certificate above a recent procurement disclosure", () => {
    const cert = {
      id: "evd_cert",
      evidence_type: "bee_certificate",
      lifecycle_state: "current",
      issue_date: "2026-04-14",
      reported_bee_level: "3",
    };
    const proc = {
      id: "evd_proc",
      evidence_type: "government_procurement_disclosure",
      issue_date: "2026-07-01",
      issue_date_precision: "month",
      reported_bee_level: "4",
    };
    assert.ok(latestEvidenceRank(cert) > latestEvidenceRank(proc));
    assert.equal(latestEvidenceKind(cert), "current_certificate");
    assert.equal(latestEvidenceKind(proc), "official_procurement_disclosure");
    assert.equal(selectLatestPublicEvidence([proc, cert])?.id, "evd_cert");
    assert.equal(
      sourceOrganisationLabel({
        evidence_type: "bee_certificate",
        document_issuer: "empowerlogic",
        agency_name: "EmpowerLogic (Pty) Ltd",
      }),
      "EmpowerLogic (Pty) Ltd",
    );
  });
});

describe("repair claim merge", () => {
  it("fills missing expiry and keeps edited values and locks", () => {
    const out = mergeRepairClaims({
      previous: [
        {
          field_key: "bee_level",
          raw_value: "Level 4",
          normalized_value: "4",
          edited_value: "3",
          confidence: 0.8,
          source_snippet: "Level 4",
          parser: "deterministic/v1",
          section: null,
          edited_by: "adm_1",
          edited_at: "2026-01-01",
          published_state: "published",
          review_state: "edited",
        },
        {
          field_key: "issue_date",
          raw_value: "1 Jan 2025",
          normalized_value: "2025-01-01",
          edited_value: null,
          confidence: 0.8,
          source_snippet: "Issue",
          parser: "deterministic/v1",
          section: null,
          edited_by: null,
          edited_at: null,
          published_state: "published",
          review_state: "approved",
        },
      ],
      extracted: [
        {
          field: "bee_level",
          raw_value: "Level 2",
          normalized_value: "2",
          confidence: 0.8,
          page: null,
          locator: "Level 2",
          warning: null,
        },
        {
          field: "expiry_date",
          raw_value: "31 December 2025",
          normalized_value: "2025-12-31",
          confidence: 0.8,
          page: null,
          locator: "Expiry Date",
          warning: null,
        },
      ],
      lockedFields: new Set(["bee_level"]),
      evidencePublished: true,
    });
    const byField = Object.fromEntries(out.claims.map((c) => [c.field_key, c]));
    assert.equal(byField.bee_level?.edited_value, "3");
    assert.equal(byField.expiry_date?.normalized_value, "2025-12-31");
    assert.equal(out.conflicts.some((c) => c.field === "bee_level"), true);
  });

  it("does not silently replace a mismatched registration number", () => {
    const out = mergeRepairClaims({
      previous: [],
      extracted: [
        {
          field: "registration_number",
          raw_value: "1995/000523/07",
          normalized_value: "199500052307",
          confidence: 0.9,
          page: null,
          locator: "Reg",
          warning: null,
        },
      ],
      lockedFields: new Set(),
      entityReg: "195100000906",
      evidencePublished: true,
    });
    assert.equal(out.conflicts.some((c) => c.field === "registration_number"), true);
    assert.equal(out.claims[0]?.published_state, "unpublished");
  });

  it("replaces a same-day expiry with a distinct extracted expiry", () => {
    const out = mergeRepairClaims({
      previous: [
        {
          field_key: "issue_date",
          raw_value: "07/11/2025",
          normalized_value: "2025-11-07",
          edited_value: null,
          confidence: 0.8,
          source_snippet: "07/11/2025",
          parser: "repair/v1",
          section: null,
          edited_by: null,
          edited_at: null,
          published_state: "published",
          review_state: "approved",
        },
        {
          field_key: "expiry_date",
          raw_value: "07/11/2025",
          normalized_value: "2025-11-07",
          edited_value: null,
          confidence: 0.8,
          source_snippet: "07/11/2025",
          parser: "repair/v1",
          section: null,
          edited_by: null,
          edited_at: null,
          published_state: "published",
          review_state: "approved",
        },
      ],
      extracted: [
        { field: "issue_date", raw_value: "07/11/2025", normalized_value: "2025-11-07", confidence: 0.86, page: null, locator: "07/11/2025", warning: null },
        { field: "expiry_date", raw_value: "06/11/2026", normalized_value: "2026-11-06", confidence: 0.86, page: null, locator: "06/11/2026", warning: null },
      ],
      lockedFields: new Set(),
      evidencePublished: true,
    });
    const expiry = out.claims.find((c) => c.field_key === "expiry_date");
    assert.equal(expiry?.normalized_value, "2026-11-06");
  });

  it("drops certificate prose used as a legal entity name", () => {
    const out = mergeRepairClaims({
      previous: [
        {
          field_key: "legal_entity_name",
          raw_value: "measured against codes of good practice on broad based black",
          normalized_value: "measured against codes of good practice on broad based black",
          edited_value: null,
          confidence: 0.5,
          source_snippet: "measured entity measured against the Codes of Good Practice",
          parser: "repair/v1",
          section: null,
          edited_by: null,
          edited_at: null,
          published_state: "published",
          review_state: "approved",
        },
      ],
      extracted: [
        {
          field: "legal_entity_name",
          raw_value: "Clover (Pty) Ltd",
          normalized_value: normalizeName("Clover (Pty) Ltd"),
          confidence: 0.8,
          page: null,
          locator: "Measured Entity: Clover (Pty) Ltd",
          warning: null,
        },
      ],
      lockedFields: new Set(),
      evidencePublished: true,
      linkedName: "Clover (Pty) Ltd",
    });
    assert.equal(out.claims.find((c) => c.field_key === "legal_entity_name")?.normalized_value, normalizeName("Clover (Pty) Ltd"));
  });

  it("replaces an unpublished template issue date with the re-extracted issue date", () => {
    const out = mergeRepairClaims({
      previous: [
        {
          field_key: "issue_date",
          raw_value: "08/09/2023",
          normalized_value: "2023-09-08",
          edited_value: null,
          confidence: 0.6,
          source_snippet: "Issued",
          parser: "deterministic/v1",
          section: null,
          edited_by: null,
          edited_at: null,
          published_state: "unpublished",
          review_state: "pending",
        },
      ],
      extracted: [
        {
          field: "issue_date",
          raw_value: "28 November 2025",
          normalized_value: "2025-11-28",
          confidence: 0.86,
          page: null,
          locator: "Initial Issue Date",
          warning: null,
        },
      ],
      lockedFields: new Set(),
      evidencePublished: false,
    });
    assert.equal(out.claims.find((c) => c.field_key === "issue_date")?.normalized_value, "2025-11-28");
    assert.equal(out.conflicts.length, 0);
  });
});

describe("claim quality", () => {
  it("rejects sentence fragments as entity names", () => {
    assert.equal(
      isPlausibleEntityName("measured against codes of good practice on broad based black", {
        canonicalName: "Clover (Pty) Ltd",
      }).ok,
      false,
    );
    assert.equal(isPlausibleEntityName("and is an").ok, false);
    assert.equal(isPlausibleEntityName("Clover (Pty) Ltd", { canonicalName: "Clover (Pty) Ltd" }).ok, true);
  });
  it("normalises claim-type aliases", () => {
    assert.equal(canonicalFieldKey("bbbee_level"), "bee_level");
    assert.equal(canonicalFieldKey("verifier"), "verification_agency");
    assert.equal(canonicalFieldKey("sector_code"), "scorecard_type");
  });
  it("omits junk locators", () => {
    assert.equal(publicLocator("measured entity measured against the Codes of Good Practice on Broad Based Black"), null);
    assert.equal(publicLocator("Page 1"), "Page 1");
    assert.equal(publicLocator("Measured entity field"), "Measured entity field");
  });
  it("rejects signatories that swallowed a field label", () => {
    assert.equal(isPlausibleSignatory("jeanet mahlalela certificate number"), false);
    assert.equal(isPlausibleSignatory("Jeanet Mahlalela"), true);
  });
});

describe("workingValue", () => {
  it("does not throw on missing claims", () => {
    assert.equal(workingValue(undefined), null);
    assert.equal(workingValue(null), null);
  });
});

describe("passwords", () => {
  it("hashes and verifies", async () => {
    const hash = await hashPassword("correct-horse-battery");
    assert.equal(hash.startsWith("scrypt$"), true);
    assert.equal(await verifyPassword("correct-horse-battery", hash), true);
    assert.equal(await verifyPassword("wrong", hash), false);
  });
  it("enforces the password policy", () => {
    assert.equal(passwordPolicyError("short"), "Password must be at least 12 characters.");
    assert.equal(passwordPolicyError("twelve chars"), null);
  });
  it("validates a password change", () => {
    assert.equal(checkPasswordChange({
      currentMatches: false,
      currentPassword: "old-password-1",
      newPassword: "new-password-12",
      confirmPassword: "new-password-12",
    }).ok, false);
    assert.equal(checkPasswordChange({
      currentMatches: true,
      currentPassword: "old-password-1",
      newPassword: "new-password-12",
      confirmPassword: "mismatch-xxxx",
    }).ok, false);
    assert.equal(checkPasswordChange({
      currentMatches: true,
      currentPassword: "old-password-1",
      newPassword: "old-password-1",
      confirmPassword: "old-password-1",
    }).ok, false);
    assert.equal(checkPasswordChange({
      currentMatches: true,
      currentPassword: "old-password-1",
      newPassword: "new-password-12",
      confirmPassword: "new-password-12",
    }).ok, true);
  });
});

describe("validation and automation", () => {
  it("flags expiry before issue", () => {
    const flags = validateClaims({
      evidence: { evidence_type: "bee_certificate", issue_date: "2026-01-02", expiry_date: "2026-01-01", content_hash: "a", mime_type: "application/pdf", source_domain: "x.com" },
      claims: [],
    });
    assert.equal(flags.some((f) => f.code === "expiry_before_issue"), true);
  });
  it("does not auto-publish under conservative defaults", () => {
    const result = evaluateAutomation({
      enabled: false,
      ruleEnabled: false,
      ruleVersion: 1,
      config: {
        officialCompanyDomain: true,
        recognizedDocumentType: true,
        minimumConfidence: 0.98,
        exactEntityMatch: true,
        validDates: true,
        noConflictingCurrentEvidence: true,
        knownVerifier: false,
        registrationNumberConsistency: true,
        manualLockConflictMustBeFalse: true,
      },
      flags: [],
      officialDomain: true,
      recognizedType: true,
      exactEntityMatch: true,
      knownVerifier: true,
      minClaimConfidence: 0.99,
      hasLockConflict: false,
      entityAutomation: "review_only",
    });
    assert.equal(result.pass, false);
  });
});
