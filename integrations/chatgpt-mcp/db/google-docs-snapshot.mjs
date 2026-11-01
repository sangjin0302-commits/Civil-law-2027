import { classifyDocumentSnapshot, fetchGoogleDocReadOnly, normalizeDocumentSnapshot, sha256 } from "./google-docs-sync.mjs";
import { normalizedPrompt, parseP1Document, parseP2Document } from "./google-docs-parser.mjs";
import { requireSubject } from "../subjects.mjs";

const SOURCES = new Map([
  ["SRC-CIV-004", parseP1Document],
  ["SRC-CIV-004B", parseP1Document],
  ["SRC-CIV-005", parseP2Document],
]);

// Docs holds prompt text. Official answers and grading keys must arrive through a
// separate verified maintenance path; never infer them from the question document.
export function snapshotFromGoogleDoc(document, sourceId, stage = null, subjectId = "CIVIL") {
  requireSubject(subjectId, stage);
  const prefix = subjectId === "CIVIL" ? "CIV" : subjectId.replaceAll("_", "-");
  const registeredStage = new RegExp(`^SRC-${prefix}-AUTO-[a-f0-9]{32}$`).test(sourceId) ? stage : null;
  const parser = (subjectId === "CIVIL" ? SOURCES.get(sourceId) : null) ||
    (registeredStage === "P1" ? parseP1Document : registeredStage === "P2" ? parseP2Document : null);
  if (!parser) throw new Error("unapproved Google Docs source");
  const parsed = parser(document, sourceId);
  if (registeredStage && parsed.problems.length === 0) {
    throw new Error("no official problems recognized in registered Google Doc");
  }
  const held = new Map();
  const caseKey = key => key.replace(/-소문항\d+$/, '');
  if (subjectId !== 'CIVIL' && stage === 'P2') {
    const hold = (key, reason) => {
      const group = caseKey(key);
      if (!held.has(group)) held.set(group, new Set());
      held.get(group).add(reason);
    };
    for (const key of parsed.conflictingKeys) hold(key, 'CONFLICTING_SOURCE_OCCURRENCES');
    for (const p of parsed.problems) {
      if (!Number.isFinite(p.maxPoints) || p.maxPoints <= 0) hold(p.stableKey, 'SOURCE_INVALID_MAX_POINTS');
    }
    // Same case facts plus the same target heading repeated in one case creates
    // two ordinal keys for one target. Hold that complete case, never pick one.
    // Identical text in different cases/years retains existing duplicate review.
    const targets = new Set();
    for (const p of parsed.problems) {
      const identity = JSON.stringify([caseKey(p.stableKey), p.promptDigest]);
      if (targets.has(identity)) hold(p.stableKey, 'DUPLICATE_SOURCE_TARGET');
      targets.add(identity);
    }
  } else if (parsed.conflictingKeys.length) throw new Error("conflicting duplicate stable keys in Google Doc");
  const problems = parsed.problems.filter(p => !held.has(caseKey(p.stableKey))).map((problem) => ({
    stableKey: problem.stableKey,
    sourceLocator: problem.sourceLocator,
    sourceVersion: "docs:" + sha256({ promptDigest: problem.promptDigest,
      stage: problem.stage, maxPoints: problem.maxPoints, sourceOrder: problem.sourceOrder }),
    sourceOrder: problem.sourceOrder,
    stage: problem.stage,
    unitId: null,
    promptText: problem.promptText,
    maxPoints: problem.maxPoints,
    selectionMetadata: {},
    gradingFieldsKnown: false,
    metadataFieldsKnown: false,
  }));
  const snapshot = normalizeDocumentSnapshot({
    subjectId,
    documentId: document.documentId,
    sourceId,
    title: document.title || sourceId,
    revisionId: document.revisionId,
    parserVersion: "google-docs-parser-v1",
    contentDigest: sha256(document.tabs?.length ? document.tabs : document.body),
    problems,
  });
  return subjectId !== 'CIVIL' && stage === 'P2'
    ? { ...snapshot, heldCases: [...held].map(([caseKey, reasons]) => ({ caseKey, reasons: [...reasons].sort() })) }
    : snapshot;
}

export async function fetchGoogleDocsSnapshotReadOnly({ documentId, sourceId, stage = null, subjectId = "CIVIL", accessToken, fetchImpl }) {
  const document = await fetchGoogleDocReadOnly({ documentId, accessToken, fetchImpl });
  return snapshotFromGoogleDoc(document, sourceId, stage, subjectId);
}

// Diagnostic only. Existing baseline rows often have a Sheets sourceVersion and
// no Docs source map, so metadata-only candidates need explicit baseline review.
export function dryRunGoogleDocsCandidates(snapshot, currentProblems = []) {
  const candidates = classifyDocumentSnapshot(snapshot.problems, currentProblems, snapshot.documentId);
  const duplicateKeys = new Set(candidates.filter((item) => item.kind === "DUPLICATE")
    .map((item) => item.payload.duplicateStableKey));
  const currentByKey = new Map(currentProblems.map((problem) => [problem.stableKey, problem]));
  const counts = { NEW: 0, MODIFIED: 0, UNCHANGED: 0, DUPLICATE: 0, DELETE_CANDIDATE: 0 };
  let normalizedOnly = 0;
  let baselineMetadataOnly = 0;
  for (const next of snapshot.problems) {
    if (duplicateKeys.has(next.stableKey)) { currentByKey.delete(next.stableKey); continue; }
    const prior = currentByKey.get(next.stableKey);
    if (!prior) { counts.NEW += 1; continue; }
    currentByKey.delete(next.stableKey);
    const exactPrompt = next.promptDigest === prior.promptDigest;
    const samePrompt = exactPrompt || (prior.promptText != null &&
      normalizedPrompt(next.promptText) === normalizedPrompt(prior.promptText));
    const materialChange = !samePrompt || next.stage !== prior.stage ||
      Number(next.maxPoints ?? 0) !== Number(prior.maxPoints ?? 0);
    if (materialChange) counts.MODIFIED += 1;
    else {
      counts.UNCHANGED += 1;
      if (!exactPrompt) normalizedOnly += 1;
      if (next.sourceVersion !== prior.sourceVersion || next.sourceLocator !== prior.sourceLocator ||
          Number(next.sourceOrder) !== Number(prior.sourceOrder)) baselineMetadataOnly += 1;
    }
  }
  counts.DELETE_CANDIDATE = currentByKey.size;
  counts.DUPLICATE = candidates.filter((item) => item.kind === "DUPLICATE").length;
  return {
    readOnly: true,
    documentId: snapshot.documentId,
    revisionId: snapshot.revisionId,
    parsedUnique: snapshot.problems.length,
    counts,
    promptModified: counts.MODIFIED,
    normalizedOnly,
    baselineMetadataOnly,
    needsReview: counts.NEW + counts.MODIFIED + counts.DUPLICATE + counts.DELETE_CANDIDATE > 0,
  };
}
