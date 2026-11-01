import crypto from "node:crypto";

export const digestText = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

export function documentParagraphs(document) {
  const result = [];
  function appendContent(content, tabId) {
    for (const element of content || []) {
      const paragraph = element.paragraph;
      if (!paragraph) continue;
      const text = (paragraph.elements || []).map((item) => item.textRun?.content || "").join("")
        .replace(/\n$/, "").trim();
      if (!text) continue;
      result.push({
        text,
        tabId: tabId || "body",
        startIndex: Number(element.startIndex || 0),
        endIndex: Number(element.endIndex || 0),
      });
    }
  }
  function visitTab(tab) {
    const documentTab = tab.documentTab || {};
    appendContent(documentTab.body?.content, tab.tabProperties?.tabId);
    for (const child of tab.childTabs || []) visitTab(child);
  }
  if (Array.isArray(document.tabs) && document.tabs.length) {
    for (const tab of document.tabs) visitTab(tab);
  } else {
    appendContent(document.body?.content, "body");
  }
  return result;
}

function dedupe(items) {
  const byKey = new Map();
  let duplicateOccurrences = 0;
  const conflictingKeys = [];
  for (const item of items) {
    const prior = byKey.get(item.stableKey);
    if (!prior) byKey.set(item.stableKey, item);
    else {
      duplicateOccurrences += 1;
      if (prior.promptDigest !== item.promptDigest) conflictingKeys.push(item.stableKey);
    }
  }
  return { problems: [...byKey.values()], duplicateOccurrences, conflictingKeys };
}

export function parseP1Document(document, sourceId) {
  const paragraphs = documentParagraphs(document);
  const problems = [];
  const header = /^\[([^\]]+)\]\s*(.*?)\s*\|\s*([OX])(?:\s+지문:\s*([\s\S]+))?\s*$/;
  for (let index = 0; index < paragraphs.length; index += 1) {
    const match = paragraphs[index].text.match(header);
    if (!match) continue;
    const rawPrompt = match[4]?.trim() ||
      paragraphs[index + 1]?.text.match(/^지문:\s*([\s\S]+)$/)?.[1]?.trim();
    // Some source lines append an editorial correction after the question.
    // Never expose that explanation as part of the issued prompt.
    const prompt = rawPrompt?.split(/\s+정정 해설:\s*/)[0].trim();
    if (!prompt) throw new Error("P1 prompt missing after " + match[1]);
    problems.push({
      stableKey: sourceId + "|" + match[1].trim(),
      sourceLocator: paragraphs[index].tabId + ":" + paragraphs[index].startIndex,
      promptText: prompt,
      promptDigest: digestText(prompt),
      stage: "P1",
      maxPoints: null,
      sourceOrder: problems.length,
    });
  }
  for (const record of separateP1Records(paragraphs, sourceId)) {
    if (!record.promptText) continue;
    problems.push({ stableKey: record.stableKey, sourceLocator: record.sourceLocator,
      promptText: record.promptText, promptDigest: digestText(record.promptText),
      stage: 'P1', maxPoints: null, sourceOrder: problems.length });
  }
  return { ...dedupe(problems), occurrenceCount: problems.length };
}

// Observed older bank format: 문항, metadata, 〔topic〕statement, answer/explanation.
// Only explicit O/X answers qualify; multiple-choice answers are not converted.
function separateP1Records(paragraphs, sourceId) {
  const records = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const id = paragraphs[i].text.match(/^문항\s+([가-힣A-Za-z][가-힣A-Za-z0-9_-]*)$/);
    if (!id) continue;
    let end = i + 1;
    while (end < paragraphs.length && !/^문항\s+/.test(paragraphs[end].text)) end++;
    const block = paragraphs.slice(i + 1, end).map(p => p.text);
    const answers = block.map(t => t.match(/^정답\s*:\s*([OX])\s*$/)?.[1]).filter(Boolean);
    const start = block.findIndex(t => /^〔/.test(t));
    const stop = block.findIndex((t, j) => j > start && /^(?:정답\s*:|해설(?:\s|$|:)|정정 해설(?:\s|$|:))/.test(t));
    if (answers.length !== 1 || start < 0 || stop < 0) continue;
    records.push({ stableKey: sourceId + '|' + id[1], answer: answers[0],
      sourceLocator: paragraphs[i].tabId + ':' + paragraphs[i].startIndex,
      promptText: block.slice(start, stop).join('\n') });
    i = end - 1;
  }
  return records;
}

export function parseP1GradingKeys(document, sourceId) {
  const paragraphs = documentParagraphs(document), records = [];
  for (const paragraph of paragraphs) {
    const match = paragraph.text.match(/^\[([^\]]+)\]\s*.*?\s*\|\s*([OX])(?:\s+지문:\s*[\s\S]+)?\s*$/);
    if (match) records.push({ stableKey: sourceId + '|' + match[1].trim(), answer: match[2] });
  }
  records.push(...separateP1Records(paragraphs, sourceId).map(({stableKey,answer}) => ({stableKey,answer})));
  const byKey = new Map(), conflictingKeys = new Set();
  let duplicateOccurrences = 0;
  for (const r of records) {
    if (byKey.has(r.stableKey)) {
      duplicateOccurrences++;
      if (byKey.get(r.stableKey).answer !== r.answer) conflictingKeys.add(r.stableKey);
    } else byKey.set(r.stableKey, r);
  }
  return { keys: [...byKey.values()].filter(r => !conflictingKeys.has(r.stableKey)),
    conflictingKeys: [...conflictingKeys], duplicateOccurrences, occurrenceCount: records.length };
}

export function normalizedPrompt(value) {
  return String(value)
    .replace(/\*\*/g, "")
    // Compare rendering escapes only; keep digits, negation, legal operators and words.
    .replace(/\\(?=[~\[\]])/g, "")
    .replace(/(▶ 풀이 대상:\s*현실답안[^\n]*?)\s*(?:\((\d+(?:\.\d+)?)점\)|\.(\d+(?:\.\d+)?)점)$/gm,
      (_whole, heading, parenthesized, dotted) => `${heading.trim()} (${parenthesized || dotted}점)`)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function parseP2Document(document, sourceId) {
  const paragraphs = documentParagraphs(document);
  const problems = [];
  let year = null;
  let exam = null;
  let mainQuestion = null;
  let blockStart = -1;
  let activeBlock = null;
  let answerOrdinal = 0;
  const numberedAnswerPattern = /^현실답안\s*[1-9]\d?(?:[-\s].*?)?(\d+(?:\.\d+)?)점(?:의\s*(\d+)\/(\d+))?/;
  // Drafting sources use one unnumbered target per case. Do not reinterpret
  // mixed numbered banks: doing so would shift their established ordinals.
  const answerPattern = paragraphs.some(p => numberedAnswerPattern.test(p.text))
    ? numberedAnswerPattern : /^현실답안\s*\((\d+(?:\.\d+)?)점\)$/;
  function pushTarget(heading, paragraph) {
    const match = heading.match(answerPattern);
    if (!match || !activeBlock) return;
    answerOrdinal += 1;
    const basePoints = Number(match[1]);
    const points = match[2] ? basePoints * Number(match[2]) / Number(match[3]) : basePoints;
    const promptText = activeBlock + "\n\n▶ 풀이 대상: " + heading;
    const stableKey = sourceId + "|" + year + "-제" + exam + "회-문" + mainQuestion + "-소문항" + answerOrdinal;
    problems.push({
      stableKey,
      sourceLocator: paragraph.tabId + ":" + paragraph.startIndex,
      promptText,
      promptDigest: digestText(promptText),
      normalizedPromptDigest: digestText(normalizedPrompt(promptText)),
      stage: "P2",
      maxPoints: points,
      sourceOrder: problems.length,
    });
  }
  for (let index = 0; index < paragraphs.length; index += 1) {
    const text = paragraphs[index].text;
    const yearMatch = text.match(/^(\d{4})년도\s*\(제(\d+)회\)$/);
    if (yearMatch) {
      year = Number(yearMatch[1]);
      exam = Number(yearMatch[2]);
      mainQuestion = null;
      blockStart = -1;
      activeBlock = null;
      answerOrdinal = 0;
      continue;
    }
    const mainMatch = text.match(/^문\s*(\d+)$/);
    if (mainMatch && year) {
      mainQuestion = Number(mainMatch[1]);
      blockStart = -1;
      activeBlock = null;
      answerOrdinal = 0;
      continue;
    }
    if (text === "문제" && year && mainQuestion) {
      blockStart = index + 1;
      continue;
    }
    if (text === "현실답안 및 해설" && blockStart >= 0) {
      const block = paragraphs.slice(blockStart, index).map((item) => item.text);
      // A few source revisions place model-answer headings before the section
      // delimiter. Keep all targets, but exclude answer bodies from case facts.
      const firstAnswer = block.findIndex((line) => answerPattern.test(line));
      activeBlock = block.slice(0, firstAnswer < 0 ? block.length : firstAnswer).join("\n");
      for (let offset = 0; offset < block.length; offset += 1) {
        pushTarget(block[offset], paragraphs[blockStart + offset]);
      }
      blockStart = -1;
      continue;
    }
    pushTarget(text, paragraphs[index]);
  }
  return { ...dedupe(problems), occurrenceCount: problems.length };
}
