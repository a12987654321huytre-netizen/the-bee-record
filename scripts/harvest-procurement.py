#!/usr/bin/env python3
"""Download official procurement pages/PDFs for B-BBEE disclosure extraction."""
from __future__ import annotations

import os
import re
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ROOT = Path("/tmp/bee-sources")
UA = "TheBEERecord/1.0 research bot (public procurement evidence index; +https://the-bee-record.vercel.app)"


def fetch(url: str, dest: Path, timeout: int = 45) -> tuple[bool, str]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 800:
        return True, "exists"
    req = Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urlopen(req, timeout=timeout) as resp:
            data = resp.read()
            dest.write_bytes(data)
            return True, f"ok {len(data)}"
    except HTTPError as e:
        return False, f"http {e.code}"
    except Exception as e:
        return False, type(e).__name__


HEALTH_PDFS = [
    # Successful suppliers (often include Contribution Level + CSD)
    "https://www.health.gov.za/wp-content/uploads/2026/08/HP08-2026SSP_Successful-Suppliers_31-July-2026.pdf",
    "https://www.health.gov.za/wp-content/uploads/2026/06/HP07-2026DAI_Successful-Suppliers_22-June-2026.pdf",
    "https://www.health.gov.za/wp-content/uploads/2026/06/HP03-2026CHM_Successful-Suppliers_22-June-2026.pdf",
    "https://www.health.gov.za/wp-content/uploads/2026/06/HP13-2025ARV_01-Successful-Supplier-19-June-2026.pdf",
    "https://www.health.gov.za/wp-content/uploads/2026/06/HP02-2025AI-01_Successful-Suppliers_-18-June-2026.pdf",
    "https://www.health.gov.za/wp-content/uploads/2026/06/HP04-2026ONC_Successful-Suppliers_12-June-2026.pdf",
    "https://www.health.gov.za/wp-content/uploads/2026/05/HP16-2027EPI_Successful-Suppliers_11-May-2026.pdf",
    "https://www.health.gov.za/wp-content/uploads/2026/04/HP06-2024SVP-03_Successful-Suppliers_9-April-2026.pdf",
    "https://www.health.gov.za/wp-content/uploads/2026/04/HP09-2026SD_Successful-Suppliers_Updated_16-April-2026.pdf",
    "https://www.health.gov.za/wp-content/uploads/2025/08/HP02-2025AI_Successful-Suppliers_25-July-2025-Updated.pdf",
    "https://www.health.gov.za/wp-content/uploads/2025/08/HP13-2025ARV_Successful-Suppliers-2.pdf",
    "https://www.health.gov.za/wp-content/uploads/2025/08/HP01-2025TB_Successful-Suppliers-1.pdf",
    "https://www.health.gov.za/wp-content/uploads/2025/06/HP06-2024SVP-02_Successful-Suppliers_6-June-2025.pdf",
    "https://www.health.gov.za/wp-content/uploads/2025/02/HP05-2024DI-01_Successful-Suppliers.pdf",
    "https://www.health.gov.za/wp-content/uploads/2024/11/HP06-2024SVP-01_Successful-Supplier_1-Nov-2024.pdf",
    "https://www.health.gov.za/wp-content/uploads/2024/09/HP10-2025BIO_Successful-Suppliers_-13-Sep-2024.pdf",
    "https://www.health.gov.za/wp-content/uploads/2025/01/HP12-2023LQ_01_Successful-Supplier-MS-approved.pdf",
    "https://www.health.gov.za/wp-content/uploads/2024/06/HP11-2023LVP_01-Successful-Supplier.pdf",
    "https://www.health.gov.za/wp-content/uploads/2024/01/HP06-2024SVP-Successful-Suppliers-24-Jan-2024.pdf",
    "https://www.health.gov.za/wp-content/uploads/2024/01/HP05-2024DI_Successful-Suppliers-24-Jan-2024.pdf",
    "https://www.health.gov.za/wp-content/uploads/2023/09/HP16-2024EPI-02_Successful-Supplier.pdf",
    "https://www.health.gov.za/wp-content/uploads/2023/09/HP12-2023LQ_Successful-Suppliers.pdf",
    "https://www.health.gov.za/wp-content/uploads/2023/08/HP11-2023LVP_Successful-Suppliers-List.pdf",
    "https://www.health.gov.za/wp-content/uploads/2023/07/HP16-2024EPI_01-Successful-Supplier_10-July-2023.pdf",
    "https://www.health.gov.za/wp-content/uploads/2023/04/HP16-2024EPI_Successful-Suppliers-12-April-2023.pdf",
    "https://www.health.gov.za/wp-content/uploads/2023/06/HP03-2023CHM_Successful-Suppliers.pdf",
    "https://www.health.gov.za/wp-content/uploads/2023/03/HP07-2023DAI_Successful-bidders.pdf",
    "https://www.health.gov.za/wp-content/uploads/2023/03/HP08-2023SSP-Successful-bidders.pdf",
    "https://www.health.gov.za/wp-content/uploads/2024/02/HP04-2024ONC_Successful-Suppliers-2-Feb-2024.pdf",
    "https://www.health.gov.za/wp-content/uploads/2025/01/HP04-2024ONC_01-Successful-Suppliers-MS-approved.pdf",
    "https://www.health.gov.za/wp-content/uploads/2025/12/HP04-2024ONC_02_Successful-Suppliers_22-Dec-2025_AC.pdf",
    "https://www.health.gov.za/wp-content/uploads/2023/10/HP09-2023SD_Successful-Suppliers_updated.pdf",
    "https://www.health.gov.za/wp-content/uploads/2021/07/HP09-2021SD_Successful-Suppliers.pdf",
    "https://www.health.gov.za/wp-content/uploads/2021/05/HP06-2021SVP_Successful-Suppliers.pdf",
    "https://www.health.gov.za/wp-content/uploads/2022/04/HP04-2022ONC_Successful-Suppliers.pdf",
    "https://www.health.gov.za/wp-content/uploads/2022/07/HP03-2020CHM_01_Successful-Suppliers.pdf",
    "https://www.health.gov.za/wp-content/uploads/2022/07/HP03-2020CHM_Successful-Suppliers.pdf",
    "https://www.health.gov.za/wp-content/uploads/2022/02/HP02-2021AI-01_Successful-Suppliers.pdf",
    "https://www.health.gov.za/wp-content/uploads/2022/02/HP01-2021TB-01_Successful-Suppliers.pdf",
    "https://www.health.gov.za/wp-content/uploads/2022/02/HP09-2021SD-01_Successful-Suppliers.pdf",
    "https://www.health.gov.za/wp-content/uploads/2022/07/HP08-2020SSP_01_Successful-Suppliers.pdf",
    "https://www.health.gov.za/wp-content/uploads/2022/07/HP08-2020SSP_Successful-Suppliers.pdf",
    "https://www.health.gov.za/wp-content/uploads/2022/07/HP07-2020DAI_01_Successful-Suppliers.pdf",
    "https://www.health.gov.za/wp-content/uploads/2022/07/HP07-2020DAI_Successful-Suppliers.pdf",
    # Award notices
    "https://www.health.gov.za/wp-content/uploads/2026/08/AWARD-NOTICE-NDOHF-01-2026-2027.pdf",
    "https://www.health.gov.za/wp-content/uploads/2026/06/AWARD-NOTICE-NDOHF-02-2025-2026.pdf",
    "https://www.health.gov.za/wp-content/uploads/2026/04/AWARD-NOTICE-NDOH-18-2025-2026.pdf",
    "https://www.health.gov.za/wp-content/uploads/2026/02/AWARD-NOTICE-NDOH-17-2025-2026.pdf",
    "https://www.health.gov.za/wp-content/uploads/2026/06/AWARD-NOTICE-NDOH-02-2025-2026.pdf",
    "https://www.health.gov.za/wp-content/uploads/2026/06/AWARD-NOTICE-NDOH-28-2024-2025.pdf",
    "https://www.health.gov.za/wp-content/uploads/2025/09/AWARD-NOTICE-NDOH-11-2024-2025.pdf",
    "https://www.health.gov.za/wp-content/uploads/2025/07/AWARD-NOTICE-NDOH-29-2024-2025.pdf",
    "https://www.health.gov.za/wp-content/uploads/2025/06/AWARD-NOTICE-NDOH-24-2024-2025.pdf",
    "https://www.health.gov.za/wp-content/uploads/2024/12/AWARD-NOTICE-NDOH-03-2024-2025.pdf",
    "https://www.health.gov.za/wp-content/uploads/2025/01/AWARD-NOTICE-NDOH-35-2023-2024.pdf",
    "https://www.health.gov.za/wp-content/uploads/2024/07/Award-Notice-NDOH-36-2023-2024.pdf",
    "https://www.health.gov.za/wp-content/uploads/2024/01/NDOH-37-2023-2024-Award-Notice.pdf",
    "https://www.health.gov.za/wp-content/uploads/2024/01/NDOH-09-2023-2024-Award-Notice.pdf",
    "https://www.health.gov.za/wp-content/uploads/2023/11/Award-Notice-NDOH-10-2023-2024.pdf",
    "https://www.health.gov.za/wp-content/uploads/2024/04/Award-Notice-NDOH-34-2023-2024.pdf",
    "https://www.health.gov.za/wp-content/uploads/2024/04/Award-Notice-NDOH-16-2023-2024.pdf",
    "https://www.health.gov.za/wp-content/uploads/2023/11/Award-Notice-NDOH-12-2023-2024.pdf",
    "https://www.health.gov.za/wp-content/uploads/2023/11/Award-Notice-NDOH-05-2023-2024.pdf",
    "https://www.health.gov.za/wp-content/uploads/2024/01/NDOH-08-2023-2024-Award-Notice.pdf",
    "https://www.health.gov.za/wp-content/uploads/2023/11/Award-Notice-NDOH-19-2022-2023.pdf",
    "https://www.health.gov.za/wp-content/uploads/2024/06/Award-Notice-NDOH-16-2022-2023.pdf",
    "https://www.health.gov.za/wp-content/uploads/2024/06/Award-Notice-NDOH-07-2022-2023.pdf",
    "https://www.health.gov.za/wp-content/uploads/2022/10/Award-notice-NDOH-02-2022-2023.pdf",
    "https://www.health.gov.za/wp-content/uploads/2022/09/Bid-Results.pdf",
    "https://www.health.gov.za/wp-content/uploads/2022/02/NDoH-12_2021_2022_Bid-Results.pdf",
    "https://www.health.gov.za/wp-content/uploads/2022/02/NDoH-0320212022Bid-Results.pdf",
    # Bids received (often include B-BBEE for all bidders)
    "https://www.health.gov.za/wp-content/uploads/2025/11/HP02-2025AI-01-Bids-received_Final-24-Nov-2025.pdf",
    "https://www.health.gov.za/wp-content/uploads/2025/12/HP08-2026SSP_Bids-received_Final-24-Nov-2025_Version-3BS.pdf",
    "https://www.health.gov.za/wp-content/uploads/2025/11/HP07-2026DAI_Bids-received_Final-24-Nov-2025.pdf",
    "https://www.health.gov.za/wp-content/uploads/2025/11/HP04-2026ONC-Bids-received_13-October-2025-v1.pdf",
    "https://www.health.gov.za/wp-content/uploads/2025/10/HP03-2026CHM-Bids-received_13-October-2025.pdf",
    "https://www.health.gov.za/wp-content/uploads/2025/10/HP16-2027EPI-Bids-received_13-October-2025.pdf",
    "https://www.health.gov.za/wp-content/uploads/2025/08/HP06-2024SVP_03_Bids-received-list.pdf",
    "https://www.health.gov.za/wp-content/uploads/2025/08/HP09-2026SD-Bids-received_Final-4-August-2025.pdf",
    "https://www.health.gov.za/wp-content/uploads/2025/09/HP09-2026SD-Bids-received_Final_Updated_22-Sept-2025.pdf",
    "https://www.health.gov.za/wp-content/uploads/2025/02/HP04-2024ONC_02-Bids-received_Final-24-Feb-2025.pdf",
    "https://www.health.gov.za/wp-content/uploads/2024/12/HP06-2024SVP-02-Bids-received_Final-9-Dec-2024.pdf",
    "https://www.health.gov.za/wp-content/uploads/2026/07/HP13-2025ARV-01-Bids-received_Final-8-Dec-2025.pdf",
]

HTML_PAGES = [
    ("sars/awarded-1.html", "https://www.sars.gov.za/procurement/awarded-tenders/"),
    ("sars/awarded-2.html", "https://www.sars.gov.za/procurement/awarded-tenders/page/2/"),
    ("sars/awarded-3.html", "https://www.sars.gov.za/procurement/awarded-tenders/page/3/"),
    ("sars/awarded-4.html", "https://www.sars.gov.za/procurement/awarded-tenders/page/4/"),
    ("sars/awarded-5.html", "https://www.sars.gov.za/procurement/awarded-tenders/page/5/"),
    ("sars/awarded-6.html", "https://www.sars.gov.za/procurement/awarded-tenders/page/6/"),
    ("sars/awarded-2024.html", "https://www.sars.gov.za/procurement/awarded-tenders/5/"),
    ("sars/awarded-2023.html", "https://www.sars.gov.za/procurement/awarded-tenders/4/"),
    ("sars/awarded-2022.html", "https://www.sars.gov.za/procurement/awarded-tenders/3/"),
    ("sars/awarded-2021.html", "https://www.sars.gov.za/procurement/awarded-tenders/2/"),
    ("misc/icasa-tenders.html", "https://www.icasa.org.za/pages/open-bids"),
    ("misc/icasa-awarded.html", "https://www.icasa.org.za/pages/awarded-bids"),
    ("misc/csir-tenders.html", "https://www.csir.co.za/tenders-and-rfqs"),
    ("misc/nrf-awards.html", "https://www.nrf.ac.za/category/procurement/awards-and-contracts/"),
    ("misc/sita-awarded.html", "https://www.sita.co.za/tender"),
    ("misc/publicworks.html", "https://www.publicworks.gov.za/tenders.html"),
    ("misc/dws-awarded.html", "https://www.dws.gov.za/Tenders/AwardedTenders.aspx"),
    ("misc/transport-awarded.html", "https://www.transport.gov.za/tenders-awarded"),
    ("misc/statssa.html", "https://www.statssa.gov.za/?page_id=2171"),
    ("misc/dha.html", "https://www.dha.gov.za/index.php/tenders"),
    ("misc/dsd.html", "https://www.dsd.gov.za/index.php/tenders"),
    ("misc/gcis.html", "https://www.gcis.gov.za/tenders"),
    ("misc/agriculture.html", "https://www.dalrrd.gov.za/tenders"),
    ("misc/environment.html", "https://www.dffe.gov.za/tenders"),
    ("misc/saps.html", "https://www.saps.gov.za/services/tenders.php"),
    ("misc/correctional.html", "https://www.dcs.gov.za/tenders"),
    ("misc/tourism.html", "https://www.tourism.gov.za/tenders"),
    ("misc/dtic.html", "https://www.thedtic.gov.za/tenders/"),
    ("misc/ocpo-bidders.html", "https://www.treasury.gov.za/divisions/ocpo/ostb/bidders/default.aspx"),
    ("misc/ocpo-contracts.html", "https://www.treasury.gov.za/divisions/ocpo/ostb/contracts/default.aspx"),
    ("misc/bulletins-index.html", "https://www.treasury.gov.za/divisions/ocpo/ostb/bulletins/default.aspx"),
    ("misc/westerncape-awarded.html", "https://www.westerncape.gov.za/general-publication/awarded-bids"),
    ("misc/capetown-awarded.html", "https://www.capetown.gov.za/City-Connect/Have-your-say/Tenders"),
    ("misc/gauteng-etenders.html", "https://e-tenders.gauteng.gov.za/"),
    ("misc/kzn-treasury.html", "https://www.kznreasury.gov.za/Tenders/AwardedTenders.aspx"),
    ("misc/joburg.html", "https://www.joburg.org.za/tenders/"),
    ("misc/tshwane.html", "https://www.tshwane.gov.za/sites/Departments/Financial-Services/Pages/Tenders.aspx"),
    ("misc/ethekwini.html", "https://www.durban.gov.za/pages/government/tenders"),
    ("misc/unisa.html", "https://www.unisa.ac.za/sites/corporate/default/About/Procurement"),
    ("misc/up.html", "https://www.up.ac.za/tenders"),
    ("misc/uct.html", "https://www.uct.ac.za/main/explore-uct/tenders"),
    ("misc/wits.html", "https://www.wits.ac.za/tenders/"),
    ("misc/ukzn.html", "https://ukzn.ac.za/tenders/"),
    ("misc/nwu.html", "https://www.nwu.ac.za/tenders"),
    ("misc/sun.html", "https://www.sun.ac.za/english/finance/tenders"),
    ("misc/idc.html", "https://www.idc.co.za/tenders/"),
    ("misc/dbsa.html", "https://www.dbsa.org/tenders"),
    ("misc/transnet.html", "https://www.transnet.net/TenderLifeCycle/Pages/ViewAwardedTenders.aspx"),
    ("misc/prasa.html", "https://www.prasa.com/tenders/"),
    ("misc/acsa.html", "https://www.airports.co.za/business-with-acsa/tenders"),
    ("misc/eskom.html", "https://www.eskom.co.za/tenders/"),
    ("misc/nersa.html", "https://www.nersa.org.za/tenders/"),
    ("misc/sassa.html", "https://www.sassa.gov.za/Pages/Tenders.aspx"),
    ("misc/nsfas.html", "https://www.nsfas.org.za/content/tenders.html"),
    ("misc/raf.html", "https://www.raf.co.za/Procurement/Pages/Awarded-Bids.aspx"),
    ("misc/nhi.html", "https://www.medicalschemes.co.za/tenders/"),
    ("misc/cipc.html", "https://www.cipc.co.za/tenders/"),
    ("misc/sabs.html", "https://www.sabs.co.za/tenders"),
    ("misc/sanas.html", "https://www.sanas.co.za/tenders"),
    ("misc/competition.html", "https://www.compcom.co.za/tenders/"),
    ("misc/ccma.html", "https://www.ccma.org.za/tenders/"),
    ("misc/legal-aid.html", "https://www.legal-aid.co.za/tenders/"),
    ("misc/npa.html", "https://www.npa.gov.za/tenders"),
    ("misc/siu.html", "https://www.siu.org.za/tenders/"),
    ("misc/public-protector.html", "https://www.pprotect.org/tenders"),
    ("misc/auditor-general.html", "https://www.agsa.co.za/Procurement.aspx"),
    ("misc/sars-tenders.html", "https://www.sars.gov.za/procurement/current-tenders/"),
    ("misc/health-tenders.html", "https://www.health.gov.za/tenders/"),
    ("misc/labour.html", "https://www.labour.gov.za/tenders"),
    ("misc/human-settlements.html", "https://www.dhs.gov.za/tenders"),
    ("misc/cogta.html", "https://www.cogta.gov.za/tenders"),
    ("misc/dsti-archive.html", "https://www.dsti.gov.za/about/suppliers"),
]

MISC_PDFS = [
    "https://www.icasa.org.za/uploads/files/Awards.pdf",
]


def slug_url(url: str) -> str:
    name = url.rstrip("/").split("/")[-1]
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", name)
    return name[:180] or "file"


def main() -> None:
    ok = fail = 0
    jobs: list[tuple[Path, str]] = []
    for url in HEALTH_PDFS:
        jobs.append((ROOT / "health" / slug_url(url), url))
    for rel, url in HTML_PAGES:
        jobs.append((ROOT / rel, url))
    for url in MISC_PDFS:
        jobs.append((ROOT / "icasa" / slug_url(url), url))
    # Government tender bulletins (historical official awards with B-BBEE columns)
    for year, start, end in [
        (2016, 2900, 2950),
        (2017, 2945, 3000),
        (2018, 2990, 3050),
        (2019, 3040, 3100),
        (2020, 3090, 3150),
        (2021, 3140, 3200),
    ]:
        for n in range(start, end + 1):
            url = f"https://www.treasury.gov.za/divisions/ocpo/ostb/bulletins/{year}/{n}.pdf"
            jobs.append((ROOT / "bulletins" / f"{year}-{n}.pdf", url))

    print(f"jobs {len(jobs)}")
    for dest, url in jobs:
        success, msg = fetch(url, dest)
        if success:
            ok += 1
            if msg != "exists":
                print("OK", dest.name, msg)
        else:
            fail += 1
            if "http 404" not in msg:
                print("FAIL", url, msg)
        time.sleep(0.05)
    print("done ok", ok, "fail", fail)


if __name__ == "__main__":
    main()
