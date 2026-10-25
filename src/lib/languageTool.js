export function mapLanguageToolMatches(text, matches, language) {
  if (typeof text !== 'string' || !Array.isArray(matches)) {
    throw new TypeError('Invalid LanguageTool response');
  }

  return matches.flatMap((match, index) => {
    const start = match?.offset;
    const length = match?.length;
    const replacement = match?.replacements?.find((item) => typeof item?.value === 'string')?.value;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(length) ||
      start < 0 ||
      length <= 0 ||
      start + length > text.length ||
      typeof replacement !== 'string'
    ) {
      return [];
    }
    const original = text.slice(start, start + length);
    if (replacement === original) return [];
    return [{
      id: `languagetool:${match.rule?.id || index}:${start}`,
      ruleId: match.rule?.id || 'languagetool',
      source: 'languagetool',
      start,
      end: start + length,
      original,
      replacement,
      message: match.message || '',
      language,
    }];
  });
}

export function mergeProofreadingIssues(localIssues, languageToolIssues) {
  if (!Array.isArray(localIssues) || !Array.isArray(languageToolIssues)) {
    throw new TypeError('Invalid proofreading issues');
  }

  const preferred = [...languageToolIssues];
  const fallback = localIssues.filter((local) =>
    !languageToolIssues.some((enhanced) => local.start < enhanced.end && enhanced.start < local.end)
  );

  return [...preferred, ...fallback]
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter((issue, index, all) =>
      !all.slice(0, index).some((previous) => issue.start < previous.end && previous.start < issue.end)
    );
}

export function languageToolIssuesForSource(result, text, language) {
  if (
    !result ||
    result.text !== text ||
    result.language !== language ||
    !Array.isArray(result.issues)
  ) {
    return null;
  }
  return result.issues;
}
