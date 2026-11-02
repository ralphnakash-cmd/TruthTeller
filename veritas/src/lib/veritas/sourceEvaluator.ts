import type { EvidenceRecord, SourceTier } from "./types";
import { jaccard, registrableDomain, wordShingles } from "./util";

/**
 * Source quality assessment. Deliberately simple and transparent: every
 * tier comes with a human-readable reason that is shown in the UI.
 * Search ranking is NOT used as a trust signal.
 */

const KNOWN: Record<string, { tier: SourceTier; name: string }> = {
  "archives.gov": { tier: "PRIMARY", name: "U.S. National Archives" },
  "whitehouse.gov": { tier: "PRIMARY", name: "The White House" },
  "nasa.gov": { tier: "PRIMARY", name: "NASA" },
  "loc.gov": { tier: "PRIMARY", name: "Library of Congress" },
  "si.edu": { tier: "PRIMARY", name: "Smithsonian Institution" },
  "nih.gov": { tier: "PRIMARY", name: "National Institutes of Health" },
  "cdc.gov": { tier: "PRIMARY", name: "CDC" },
  "noaa.gov": { tier: "PRIMARY", name: "NOAA" },
  "nist.gov": { tier: "PRIMARY", name: "NIST" },
  "census.gov": { tier: "PRIMARY", name: "U.S. Census Bureau" },
  "who.int": { tier: "PRIMARY", name: "World Health Organization" },
  "un.org": { tier: "PRIMARY", name: "United Nations" },
  "europa.eu": { tier: "PRIMARY", name: "European Union" },
  "esa.int": { tier: "PRIMARY", name: "European Space Agency" },
  "nature.com": { tier: "PRIMARY", name: "Nature" },
  "science.org": { tier: "PRIMARY", name: "Science" },
  "britannica.com": { tier: "REFERENCE", name: "Encyclopaedia Britannica" },
  "wikipedia.org": { tier: "REFERENCE", name: "Wikipedia" },
  "nationalgeographic.com": { tier: "REFERENCE", name: "National Geographic" },
  "merriam-webster.com": { tier: "REFERENCE", name: "Merriam-Webster" },
  "timeanddate.com": { tier: "REFERENCE", name: "timeanddate.com" },
  "history.com": { tier: "REFERENCE", name: "History.com" },
  "mayoclinic.org": { tier: "REFERENCE", name: "Mayo Clinic" },
  "clevelandclinic.org": { tier: "REFERENCE", name: "Cleveland Clinic" },
  "snopes.com": { tier: "FACT_CHECK", name: "Snopes" },
  "politifact.com": { tier: "FACT_CHECK", name: "PolitiFact" },
  "factcheck.org": { tier: "FACT_CHECK", name: "FactCheck.org" },
  "fullfact.org": { tier: "FACT_CHECK", name: "Full Fact" },
  "reuters.com": { tier: "NEWS", name: "Reuters" },
  "apnews.com": { tier: "NEWS", name: "Associated Press" },
  "bbc.com": { tier: "NEWS", name: "BBC" },
  "bbc.co.uk": { tier: "NEWS", name: "BBC" },
  "nytimes.com": { tier: "NEWS", name: "The New York Times" },
  "washingtonpost.com": { tier: "NEWS", name: "The Washington Post" },
  "theguardian.com": { tier: "NEWS", name: "The Guardian" },
  "npr.org": { tier: "NEWS", name: "NPR" },
  "wsj.com": { tier: "NEWS", name: "The Wall Street Journal" },
  "bloomberg.com": { tier: "NEWS", name: "Bloomberg" },
  "ft.com": { tier: "NEWS", name: "Financial Times" },
  "theverge.com": { tier: "NEWS", name: "The Verge" },
  "arstechnica.com": { tier: "NEWS", name: "Ars Technica" },
  "reddit.com": { tier: "LOW", name: "Reddit" },
  "quora.com": { tier: "LOW", name: "Quora" },
  "pinterest.com": { tier: "LOW", name: "Pinterest" },
  "youtube.com": { tier: "LOW", name: "YouTube" },
  "tiktok.com": { tier: "LOW", name: "TikTok" },
  "facebook.com": { tier: "LOW", name: "Facebook" },
  "x.com": { tier: "LOW", name: "X" },
  "twitter.com": { tier: "LOW", name: "X (Twitter)" },
  "medium.com": { tier: "LOW", name: "Medium" },
  "blogspot.com": { tier: "LOW", name: "Blogspot" },
  "wordpress.com": { tier: "LOW", name: "WordPress.com" },
  "answers.com": { tier: "LOW", name: "Answers.com" },
  "fandom.com": { tier: "LOW", name: "Fandom" },
};

export const TIER_WEIGHT: Record<SourceTier, number> = {
  PRIMARY: 3,
  FACT_CHECK: 3,
  REFERENCE: 2,
  NEWS: 2,
  GENERAL: 1,
  LOW: 0.5,
};

const TIER_REASON: Record<SourceTier, string> = {
  PRIMARY: "Official or primary source",
  FACT_CHECK: "Established fact-checking organization",
  REFERENCE: "Established reference work",
  NEWS: "Established news organization",
  GENERAL: "General website — not independently vetted",
  LOW: "User-generated or social content — low weight",
};

function titleCaseDomain(domain: string): string {
  const label = domain.split(".")[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function assessSource(
  host: string,
  claimEntities: string[],
  publisherHint?: string,
): { tier: SourceTier; tierReason: string; publisher: string } {
  const reg = registrableDomain(host);
  const known = KNOWN[reg] ?? KNOWN[host];
  if (known) return { tier: known.tier, tierReason: TIER_REASON[known.tier], publisher: known.name };

  const tld = host.split(".").pop() ?? "";
  if (/\.gov(\.[a-z]{2})?$/.test(host) || /\.mil$/.test(host) || host.endsWith(".gc.ca") || /\.gouv\.[a-z]{2}$/.test(host)) {
    return { tier: "PRIMARY", tierReason: "Government website", publisher: publisherHint ?? reg };
  }
  if (tld === "edu" || /\.ac\.[a-z]{2}$/.test(host)) {
    return { tier: "PRIMARY", tierReason: "University / academic website", publisher: publisherHint ?? titleCaseDomain(reg) };
  }

  // Official site of an organization named in the claim (e.g. apple.com for a MacBook claim).
  const label = reg.split(".")[0].toLowerCase();
  const entityTokens = claimEntities.flatMap((e) => e.toLowerCase().split(/[^a-z0-9]+/)).filter((t) => t.length >= 3);
  if (label.length >= 3 && entityTokens.includes(label)) {
    return {
      tier: "PRIMARY",
      tierReason: "Official website of an organization named in the claim",
      publisher: publisherHint ?? titleCaseDomain(reg),
    };
  }

  return { tier: "GENERAL", tierReason: TIER_REASON.GENERAL, publisher: publisherHint ?? titleCaseDomain(reg) };
}

/**
 * Assign independence groups: records from the same registrable domain, or
 * whose text is a near-copy of another record's text, share a group and are
 * counted once when weighing corroboration.
 */
export function assignIndependenceGroups(records: Array<Pick<EvidenceRecord, "domain" | "excerpt">>): string[] {
  const groups: string[] = [];
  const shingles = records.map((r) => wordShingles(r.excerpt));
  for (let i = 0; i < records.length; i++) {
    let group = records[i].domain ? registrableDomain(records[i].domain!) : `rec${i}`;
    for (let j = 0; j < i; j++) {
      if (jaccard(shingles[i], shingles[j]) >= 0.5) {
        group = groups[j];
        break;
      }
    }
    groups.push(group);
  }
  return groups;
}
