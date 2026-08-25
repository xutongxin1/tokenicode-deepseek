import { describe, expect, it } from 'vitest';
import { buildAskUserQuestionAnswers } from '../ask-user-question';

describe('AskUserQuestion answer payload', () => {
  const questions = [
    { question: 'Which mode should be used?', options: [{ label: 'Fast' }, { label: 'Safe' }] },
    { question: 'Which checks should run?', options: [{ label: 'Unit' }, { label: 'UI' }] },
  ];

  it('keys answers by exact question text', () => {
    expect(buildAskUserQuestionAnswers(
      questions,
      { 0: new Set([1]), 1: new Set([0, 1]) },
      {},
      {},
    )).toEqual({
      'Which mode should be used?': 'Safe',
      'Which checks should run?': 'Unit, UI',
    });
  });

  it('uses free-form text for the matching question', () => {
    expect(buildAskUserQuestionAnswers(
      questions,
      { 0: new Set([0]) },
      { 0: 'Custom mode' },
      { 0: true },
    )).toEqual({ 'Which mode should be used?': 'Custom mode' });
  });

  it('appends supplement to option-based answers only', () => {
    expect(buildAskUserQuestionAnswers(
      questions,
      { 0: new Set([0]), 1: new Set([0, 1]) },
      { 0: 'Custom mode' },
      { 0: true },
      { 1: 'Run them twice' },
    )).toEqual({
      // Free-form "other" answer is complete on its own — no supplement
      'Which mode should be used?': 'Custom mode',
      // Option-based answer merges the supplement
      'Which checks should run?': 'Unit, UI（Run them twice）',
    });
  });

  it('supplement alone without a selection still yields the supplement', () => {
    expect(buildAskUserQuestionAnswers(
      questions,
      {},
      {},
      {},
      { 0: 'Just this note' },
    )).toEqual({ 'Which mode should be used?': 'Just this note' });
  });
});
