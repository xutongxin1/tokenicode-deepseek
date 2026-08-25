export interface AskUserQuestionItem {
  question: string;
  options: Array<{ label: string }>;
}

/** Build the updated AskUserQuestion input expected by Claude Code.
 *  `supplementText` (optional) appends the user's supplement to an
 *  option-based answer: "A, B（补充内容）". Free-form "other" answers are
 *  already complete text and never get a supplement appended. */
export function buildAskUserQuestionAnswers(
  questions: AskUserQuestionItem[],
  selectedMap: Record<number, Set<number>>,
  otherText: Record<number, string>,
  useOther: Record<number, boolean>,
  supplementText: Record<number, string> = {},
): Record<string, string> {
  const answers: Record<string, string> = {};
  questions.forEach((question, questionIndex) => {
    let answer = '';
    if (useOther[questionIndex] && otherText[questionIndex]?.trim()) {
      answer = otherText[questionIndex].trim();
    } else {
      answer = Array.from(selectedMap[questionIndex] || [])
        .map((optionIndex) => question.options[optionIndex]?.label)
        .filter((label): label is string => !!label)
        .join(', ');
      const supplement = supplementText[questionIndex]?.trim();
      if (supplement) {
        answer = answer ? `${answer}（${supplement}）` : supplement;
      }
    }
    if (question.question && answer) {
      // Claude Code indexes AskUserQuestion answers by the exact question text.
      answers[question.question] = answer;
    }
  });
  return answers;
}
