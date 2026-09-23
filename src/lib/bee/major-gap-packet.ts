import type { CorpusItem } from "./corpus-import.server.ts";

/**
 * Official routes from the three major-gap evidence packets.
 * Certificates stay certificates. Reports stay disclosures. Group annexures
 * are linked as included entities and are not copied as a subsidiary's own level.
 */
export type MajorGapItem = {
  key: string;
  corpus: CorpusItem;
};

const HOLLARD_PAGE = "https://www.hollard.co.za/our-world/company-overview/b-bbee";
const HOLLARD_SHORT =
  "https://www.hollard.co.za/binaries/content/assets/hollardcoza-headless/pages/about-hollard/company-overview/b-bbee/hollard-insure-consolidation_hr-gen_3555-24-certificate-final.pdf";
const HOLLARD_LIFE =
  "https://www.hollard.co.za/binaries/content/assets/hollardcoza-headless/pages/about-hollard/company-overview/b-bbee/hollard-life-consolidation-hr-gen-3556-24-certificate-final.pdf";
const SANTAM_ANNEXURE =
  "https://www.santam.co.za/media/ej0nhqjs/b-bbee-certificate-annexure-santam-limited-san008317-rev17.pdf";
const DISCOVERY_CERT =
  "https://www.discovery.co.za/assets/discoverycoza/corporate/investor-relations/discovery-limited-b-bbee-certificate-2025.pdf";
const DISCOVERY_ANNEXURE =
  "https://www.discovery.co.za/assets/discoverycoza/corporate/investor-relations/discovery-limited-b-bbee-annexure-2025.pdf";

export const MAJOR_GAP_ITEMS: MajorGapItem[] = [
  {
    key: "media24-2026-certificate",
    corpus: {
      canonicalName: "Media24 (Pty) Ltd and Subsidiaries",
      registrationNumber: "1950/038385/07",
      website: "https://www.media24.com/contact/",
      sectorIds: ["sec_media"],
      evidence: [
        {
          url: "https://media24.com/wp-content/uploads/2026/06/ELC14766_Media24-Group_BEE-Certificate_Final.pdf",
          evidenceType: "bee_certificate",
          title: "Media24 (Pty) Ltd and Subsidiaries B-BBEE certificate ELC14766",
        },
      ],
    },
  },
  {
    key: "bkb-gen534",
    corpus: {
      canonicalName: "BKB Limited",
      registrationNumber: "1998/012435/06",
      website: "https://www.bkb.co.za/company-policies",
      sectorIds: ["sec_agriculture"],
      evidence: [
        {
          url: "https://www.bkb.co.za/assets/Corporate/gen534-bkb-limited.pdf",
          evidenceType: "bee_certificate",
          title: "BKB Limited B-BBEE certificate GEN534",
        },
      ],
    },
  },
  {
    key: "hollard-insurance",
    corpus: {
      canonicalName: "The Hollard Insurance Company Limited",
      registrationNumber: "1952/003004/06",
      website: "https://www.hollard.co.za/",
      sectorIds: ["sec_insurance"],
      evidence: [
        { url: HOLLARD_SHORT, evidenceType: "bee_certificate", title: "Hollard short-term consolidation B-BBEE certificate HR_GEN_3555_24" },
        { url: HOLLARD_PAGE, evidenceType: "company_webpage", title: "Hollard official B-BBEE page" },
      ],
    },
  },
  {
    key: "hollard-specialist-insurance",
    corpus: {
      canonicalName: "Hollard Specialist Insurance Limited",
      registrationNumber: "1966/007612/06",
      sectorIds: ["sec_insurance"],
      evidence: [
        { url: HOLLARD_SHORT, evidenceType: "bee_certificate", title: "Hollard short-term consolidation B-BBEE certificate HR_GEN_3555_24" },
      ],
    },
  },
  {
    key: "hollard-life",
    corpus: {
      canonicalName: "Hollard Life Assurance Company Limited",
      registrationNumber: "1993/001405/06",
      sectorIds: ["sec_insurance"],
      evidence: [
        { url: HOLLARD_LIFE, evidenceType: "bee_certificate", title: "Hollard life consolidation B-BBEE certificate HR_GEN_3556_24" },
        { url: HOLLARD_PAGE, evidenceType: "company_webpage", title: "Hollard official B-BBEE page" },
      ],
    },
  },
  {
    key: "hollard-specialist-life",
    corpus: {
      canonicalName: "Hollard Specialist Life Limited",
      registrationNumber: "1994/001332/06",
      sectorIds: ["sec_insurance"],
      evidence: [
        { url: HOLLARD_LIFE, evidenceType: "bee_certificate", title: "Hollard life consolidation B-BBEE certificate HR_GEN_3556_24" },
      ],
    },
  },
  {
    key: "webber-wentzel-2022",
    corpus: {
      canonicalName: "Webber Wentzel",
      entityType: "partnership",
      website: "https://www.webberwentzel.com/",
      sectorIds: ["sec_legal"],
      evidence: [
        {
          url: "https://www.webberwentzel.com/Documents/082218-webber-wentzel-b-bbee-certificate.pdf",
          evidenceType: "bee_certificate",
          title: "Webber Wentzel B-BBEE certificate PV_2206004",
        },
      ],
    },
  },
  {
    key: "sab-2019",
    corpus: {
      canonicalName: "The South African Breweries (Pty) Ltd",
      registrationNumber: "1998/006375/07",
      website: "https://www.sab.co.za/",
      sectorIds: ["sec_food"],
      evidence: [
        {
          url: "https://www.sab.co.za/sites/g/files/seuoyk1916/files/sab/4.bee-2019-min.pdf",
          evidenceType: "bee_certificate",
          title: "The South African Breweries B-BBEE certificate ELC8620RGENBB",
        },
      ],
    },
  },
  {
    key: "unilever-historical",
    corpus: {
      canonicalName: "Unilever South Africa (Pty) Ltd",
      registrationNumber: "1939/012365/07",
      website: "https://www.unilever.co.za/",
      sectorIds: ["sec_manufacturing"],
      evidence: [
        {
          url: "https://www.unilever.co.za/files/2021-bbbee-certificate.pdf",
          evidenceType: "bee_certificate",
          title: "Unilever South Africa historical B-BBEE certificate",
        },
      ],
    },
  },
  {
    key: "nestle-2024",
    corpus: {
      canonicalName: "Nestlé (South Africa) Proprietary Limited",
      registrationNumber: "1916/001498/07",
      website: "https://www.nestle-esar.com/aboutus/transformation",
      sectorIds: ["sec_food"],
      evidence: [
        {
          url: "https://www.nestle-esar.com/sites/g/files/pydnoa441/files/2024-10/NESTL%C3%89%20%28SOUTH%20AFRICA%29%20-%20Certificate%20-%202024-2025%20%281%29.pdf",
          evidenceType: "bee_certificate",
          title: "Nestlé (South Africa) B-BBEE certificate 2024-2025",
        },
      ],
    },
  },
  {
    key: "ford-2026",
    corpus: {
      canonicalName: "Ford Motor Company of Southern Africa (Manufacturing) (Pty) Ltd",
      registrationNumber: "1923/002555/07",
      website: "https://www.ford.co.za/about-ford/corporate-information/",
      sectorIds: ["sec_automotive"],
      evidence: [
        {
          url: "https://www.ford.co.za/content/dam/Ford/za/b-beee-certificate/b-bbee-certificate-ford-pty-ltd.pdf",
          evidenceType: "bee_certificate",
          title: "Ford Motor Company of Southern Africa (Manufacturing) B-BBEE certificate",
        },
      ],
    },
  },
  {
    key: "ninety-one-2026",
    corpus: {
      canonicalName: "Ninety One Limited",
      registrationNumber: "2019/526481/06",
      website: "https://ninetyone.com/en/iceland/investor-relations/reports-and-presentations",
      sectorIds: ["sec_financial"],
      jseListed: true,
      evidence: [
        {
          url: "https://ninetyone.com/-/media/documents/investor-relations/2026/91-ninety-one-limited-b-bbee-certificate-2026-27.pdf",
          evidenceType: "bee_certificate",
          title: "Ninety One Limited B-BBEE certificate 2026-27",
        },
        {
          url: "https://ninetyone.com/-/media/documents/investor-relations/2026/91-ninety-one-limited-b-bbee-compliance-report-2026-27.pdf",
          evidenceType: "investor_document",
          title: "Ninety One Limited Form B-BBEE 1 compliance report 2026-27",
        },
      ],
    },
  },
  {
    key: "kal-2025",
    corpus: {
      canonicalName: "KAL Group Limited",
      website: "https://www.kalgroup.co.za/impact/bbbee",
      sectorIds: ["sec_agriculture"],
      jseListed: true,
      evidence: [
        {
          url: "https://apos-kal-prod.s3.af-south-1.amazonaws.com/attachments/cmix2t6nm4j5c0dp67ts1qcym-kal-group-bbbee-certificate-2025-2026.pdf",
          evidenceType: "bee_certificate",
          title: "KAL Group B-BBEE certificate 2025-2026",
        },
        {
          url: "https://www.kalgroup.co.za/impact/bbbee",
          evidenceType: "company_webpage",
          title: "KAL Group official B-BBEE page",
        },
      ],
    },
  },
  {
    key: "stadio-2025",
    corpus: {
      canonicalName: "STADIO Holdings Limited",
      website: "https://stadio.co.za/b-bbee/",
      sectorIds: ["sec_education"],
      jseListed: true,
      evidence: [
        {
          url: "https://stadio.co.za/wp-content/uploads/2025/04/STADIO-Group-BBBEE-Scorecard-incl-Annexure.pdf",
          evidenceType: "bee_certificate",
          title: "STADIO Holdings Limited B-BBEE scorecard SHL010523-REV7",
        },
      ],
    },
  },
  {
    key: "fortress-2025-disclosure",
    corpus: {
      canonicalName: "Fortress Real Estate Investments Limited",
      website: "https://fortressfund.co.za/",
      sectorIds: ["sec_property"],
      jseListed: true,
      evidence: [
        {
          url: "https://fortressfund.co.za/assets/documents/reports/Fortress_integrated_report_2025.pdf",
          evidenceType: "integrated_report",
          title: "Fortress integrated report 2025",
        },
      ],
    },
  },
  {
    key: "advtech-2025-disclosure",
    corpus: {
      canonicalName: "ADvTECH Limited",
      registrationNumber: "1990/001119/06",
      website: "https://www.groupadvtech.com/financial-results",
      sectorIds: ["sec_education"],
      jseListed: true,
      evidence: [
        {
          url: "https://irp.cdn-website.com/24847d5c/files/uploaded/Advtech+Limited+-+BEE+Certificate+31+Dec+2025.pdf",
          evidenceType: "investor_document",
          title: "ADvTECH Limited B-BBEE note for the year ended 31 December 2025",
        },
      ],
    },
  },
  {
    key: "santam-annexure",
    corpus: {
      canonicalName: "Santam Limited",
      registrationNumber: "1918/001680/06",
      website: "https://www.santam.co.za/",
      sectorIds: ["sec_insurance"],
      jseListed: true,
      evidence: [
        {
          url: SANTAM_ANNEXURE,
          evidenceType: "bee_certificate",
          title: "Santam Limited B-BBEE certificate annexure SAN008317 REV17",
        },
      ],
    },
  },
  {
    key: "miway-included",
    corpus: {
      canonicalName: "MiWay Insurance Limited",
      registrationNumber: "2007/026289/06",
      sectorIds: ["sec_insurance"],
      includedOnly: { url: SANTAM_ANNEXURE, measuredEntityName: "Santam Limited" },
    },
  },
  {
    key: "discovery-limited-2025",
    corpus: {
      canonicalName: "Discovery Limited",
      website: "https://www.discovery.co.za/corporate/other-announcements",
      sectorIds: ["sec_insurance"],
      jseListed: true,
      evidence: [
        { url: DISCOVERY_CERT, evidenceType: "bee_certificate", title: "Discovery Limited B-BBEE certificate 2025" },
        { url: DISCOVERY_ANNEXURE, evidenceType: "company_disclosure", title: "Discovery Limited B-BBEE certificate annexure 2025" },
      ],
    },
  },
  {
    key: "discovery-bank-included",
    corpus: {
      canonicalName: "Discovery Bank Limited",
      registrationNumber: "2015/408745/06",
      sectorIds: ["sec_financial"],
      includedOnly: { url: DISCOVERY_ANNEXURE, measuredEntityName: "Discovery Limited" },
    },
  },
  {
    key: "senwes-2025",
    corpus: {
      canonicalName: "Senwes Limited",
      website: "https://senwes.com/",
      sectorIds: ["sec_agriculture"],
      evidence: [
        {
          url: "https://senwes.com/governance/sustainability/sustainability-report-2025",
          evidenceType: "sustainability_report",
          title: "Senwes Sustainability Report 2025",
        },
      ],
    },
  },
  {
    key: "toyota-tsam-2023",
    corpus: {
      canonicalName: "Toyota South Africa Motors (Pty) Ltd",
      website: "https://www.toyota.co.za/",
      sectorIds: ["sec_automotive"],
      evidence: [
        {
          url: "https://global.toyota/pages/global_toyota/sustainability/report/sdb/sdb24_en.pdf",
          evidenceType: "sustainability_report",
          title: "Toyota Sustainability Data Book — Toyota South Africa Motors",
        },
      ],
    },
  },
  {
    key: "sasria-2025",
    corpus: {
      canonicalName: "Sasria SOC Limited",
      website: "https://sasria.co.za/",
      sectorIds: ["sec_insurance"],
      evidence: [
        {
          url: "https://sasria.co.za/wp-content/uploads/2025/11/Sasria-Integrated-Report-2025.pdf",
          evidenceType: "integrated_report",
          title: "Sasria Integrated Report 2025",
        },
      ],
    },
  },
  {
    key: "rand-water-2025",
    corpus: {
      canonicalName: "Rand Water",
      website: "https://www.randwater.co.za/",
      evidence: [
        {
          url: "https://www.randwater.co.za/media/annual_reports/RAND%20WATER%20INTEGRATED%20ANNUAL%20REPORT%202025.pdf",
          evidenceType: "integrated_report",
          title: "Rand Water Integrated Annual Report 2025",
        },
      ],
    },
  },
  {
    key: "assupol-historical",
    corpus: {
      canonicalName: "Assupol Life Ltd",
      registrationNumber: "2010/025083/06",
      website: "https://assupol.co.za/about-us",
      sectorIds: ["sec_insurance"],
      evidence: [
        {
          url: "https://assupol.co.za/legal-requirements/assupol-accredited-with-b-bbee-level-1",
          evidenceType: "company_webpage",
          title: "Assupol Life historical Level 1 B-BBEE announcement",
        },
      ],
    },
  },
  {
    key: "pps-2023",
    corpus: {
      canonicalName: "PPS",
      website: "https://www.pps.co.za/",
      sectorIds: ["sec_insurance"],
      evidence: [
        {
          url: "https://www.pps.co.za/themes/custom/refresh/reports/integrated-report-2023/pdf/PPS_IAR23.pdf",
          evidenceType: "integrated_report",
          title: "PPS Integrated Report 2023",
        },
      ],
    },
  },
  {
    key: "microsoft-sa-2020",
    corpus: {
      canonicalName: "Microsoft South Africa",
      website: "https://news.microsoft.com/en-xm/",
      sectorIds: ["sec_ict"],
      evidence: [
        {
          url: "https://news.microsoft.com/en-xm/2020/07/29/technology-is-driving-momentous-change-in-enabling-equity/",
          evidenceType: "company_disclosure",
          title: "Microsoft South Africa historical Level 1 announcement, 29 July 2020",
        },
      ],
      sources: [
        {
          url: "https://www.microsoft.com/en-za/eeipv3/forms/rfp-administration/",
          sourceType: "company_page",
          frequency: "monthly",
        },
      ],
    },
  },
  {
    key: "ibm-sa-2019",
    corpus: {
      canonicalName: "IBM South Africa (Pty) Ltd",
      registrationNumber: "1952/000308/07",
      sectorIds: ["sec_ict"],
      allowHistoricalProcurement: true,
      procurement: [
        {
          sourceUrl:
            "https://www.fsca.co.za/Lists/Tenders/Attachments/94/FSCA201920-P002%20%5BBIDS%20RECEIVED%20REGISTER%5D.pdf",
          governmentInstitution: "Financial Sector Conduct Authority",
          tenderNumber: "FSCA201920-P002",
          awardDate: "2019-10-01",
          beeLevel: "1",
          outcome: "bidder_register",
          sourceTitle: "FSCA bids-received register — IBM South Africa (Pty) Ltd",
        },
      ],
      evidence: [
        {
          url: "https://www.gov.za/news/media-statements/minister-rob-davies-launch-ibm-equity-equivalent-investment-programme-19-feb",
          evidenceType: "government_record",
          title: "IBM Equity Equivalent Investment Programme launch — historical context, no B-BBEE level",
        },
      ],
    },
  },
  {
    key: "sapo-2025-no-level",
    corpus: {
      canonicalName: "South African Post Office SOC Ltd",
      website: "https://www.postoffice.co.za/",
      evidence: [
        {
          url: "https://www.postoffice.co.za/about/annualreport25.pdf",
          evidenceType: "annual_report",
          title: "South African Post Office annual report 2025 — B-BBEE compliance section",
        },
      ],
    },
  },
  {
    key: "gwk",
    corpus: {
      canonicalName: "GWK Limited",
      registrationNumber: "1997/022252/06",
      website: "https://www.gwk.co.za/Company/2410",
      sectorIds: ["sec_agriculture"],
      evidence: [
        {
          url: "https://www.gwk.co.za/Company/2410",
          evidenceType: "company_webpage",
          title: "GWK Limited official B-BBEE certificate page",
        },
      ],
    },
  },
  {
    key: "jse-index",
    corpus: {
      canonicalName: "JSE Limited",
      registrationNumber: "2005/022939/06",
      website: "https://group.jse.co.za/dated-document",
      jseListed: true,
      sectorIds: ["sec_financial"],
      evidence: [
        {
          url: "https://group.jse.co.za/dated-document",
          evidenceType: "company_webpage",
          title: "JSE Limited dated-document index",
        },
      ],
    },
  },
  {
    key: "saa-tenders",
    corpus: {
      canonicalName: "South African Airways",
      website: "https://www.flysaa.com/",
      evidence: [
        {
          url: "https://www.flysaa.com/about-us/leading-carrier/saa-tenders",
          evidenceType: "company_webpage",
          title: "South African Airways tenders page — B-BBEE certificate route",
        },
      ],
    },
  },
  {
    key: "dsv-air-sea",
    corpus: {
      canonicalName: "DSV South Africa (Pty) Ltd",
      tradingName: "DSV Air & Sea",
      registrationNumber: "2004/015747/07",
      website: "https://www.dsv.com/en-za/sustainability-esg/b-bbee-certificate",
      sectorIds: ["sec_transport"],
      evidence: [
        {
          url: "https://docs.dsv.com/countries/south-africa/air-sea-b-bbee/",
          evidenceType: "bee_certificate",
          title: "DSV Air & Sea B-BBEE certificate",
        },
      ],
    },
  },
  {
    key: "denel-financials",
    corpus: {
      canonicalName: "Denel SOC Ltd",
      website: "https://denel.co.za/financials",
      evidence: [
        {
          url: "https://denel.co.za/financials",
          evidenceType: "company_webpage",
          title: "Denel financials — 2025 reporting, no contributor level stated on the index",
        },
      ],
    },
  },
  {
    key: "sibanye-2026-index",
    corpus: {
      canonicalName: "Sibanye Stillwater Limited",
      registrationNumber: "2014/243852/06",
      website: "https://www.sibanyestillwater.com/news-investors/reports/regulatory/2026/",
      jseListed: true,
      evidence: [
        {
          url: "https://www.sibanyestillwater.com/news-investors/reports/regulatory/2026/",
          evidenceType: "company_webpage",
          title: "Sibanye-Stillwater 2026 regulatory filings",
        },
      ],
    },
  },
];

export const FOREIGN_MEASURED_ENTITY_NAMES = ["Prosus N.V.", "Prosus", "NEPI Rockcastle N.V.", "NEPI Rockcastle"];
