'use client';

import { submitAssignment } from '@shared/api/submissions';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { createClient } from '@/lib/supabase/client';
import {
  getEffectiveStatus,
  STATUS_BADGE_CLASS,
  STATUS_LABEL,
  type AnswerKeyEntry,
  type AssignmentRow,
  type RubricCriterion,
  type SubmissionRow,
} from './types';

function formatDue(dueAt: string | null) {
  if (!dueAt) return 'No due date';
  return new Date(dueAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Header({ assignment, contextLabel }: { assignment: AssignmentRow; contextLabel: string }) {
  const { t } = useLanguage();
  const status = getEffectiveStatus(assignment);
  return (
    <div>
      <p className="text-sm text-muted-foreground">{contextLabel}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-foreground">{assignment.title}</h1>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE_CLASS[status]}`}>{t(STATUS_LABEL[status])}</span>
      </div>
      {assignment.description && <p className="mt-2 text-sm text-muted-foreground">{assignment.description}</p>}
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>{t(`assignment.${assignment.assessment_type}`)}</span> · <span>{t(`assignment.${assignment.difficulty}`)}</span> ·{' '}
        {formatDue(assignment.due_at)}
        {assignment.questions && assignment.questions.length > 0 && (
          <> · {assignment.questions.length} questions{assignment.pass_score != null ? ` · pass at ${assignment.pass_score}` : ''}</>
        )}
        {assignment.rubric && assignment.rubric.length > 0 && (
          <> · {assignment.rubric.length}-criterion rubric ({assignment.rubric.reduce((sum, c) => sum + c.max_points, 0)} pts)</>
        )}
      </p>
    </div>
  );
}

export function StudentAssignmentView({
  assignment,
  contextLabel,
  initialSubmission,
}: {
  assignment: AssignmentRow;
  contextLabel: string;
  initialSubmission: SubmissionRow | null;
}) {
  const { t } = useLanguage();
  const [submission, setSubmission] = useState(initialSubmission);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [text, setText] = useState('');
  const isMcq = !!assignment.questions && assignment.questions.length > 0;
  const writtenQuestions = !isMcq ? (assignment.description?.split('\n\nQuestions:\n')[1]?.split('\n').filter(Boolean) ?? []) : [];
  const [writtenAnswers, setWrittenAnswers] = useState<string[]>(() => writtenQuestions.map(() => ''));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const status = getEffectiveStatus(assignment);
  const canSubmit = isMcq
    ? assignment.questions!.every((q) => selected[q.id] !== undefined)
    : writtenQuestions.length ? writtenAnswers.every((answer) => answer.trim().length > 0) : text.trim().length > 0;

  const submit = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      const answers = isMcq
        ? Object.entries(selected).map(([id, selected_index]) => ({ id, selected_index }))
        : { text: writtenQuestions.length ? writtenQuestions.map((question, index) => `${question}\n${writtenAnswers[index] ?? ''}`).join('\n\n') : text.trim() };
      const data = await submitAssignment({ assignmentId: assignment.id, answers });
      setSubmission(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <Header assignment={assignment} contextLabel={contextLabel} />

      {!submission && status === 'active' && <div className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-4"><p className="text-sm font-semibold text-foreground">Need help studying?</p><p className="mt-1 text-sm text-muted-foreground">Talk through these questions with School Buddy Live, then return here to review and submit your answers.</p><Link href={`/learning-videos?mode=live&autostart=1&classId=${encodeURIComponent(assignment.class_id)}&assignmentId=${encodeURIComponent(assignment.id)}`} className="mt-3 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Study with School Buddy Live</Link></div>}

      <div className="mt-8">
        {status === 'cancelled' ? (
          <div className="rounded-xl border border-border bg-card shadow-sm p-4">
            <p className="text-sm text-muted-foreground">{t('assignment.cancelledNotice')}</p>
          </div>
        ) : submission ? (
          <div className="rounded-xl border border-border bg-card shadow-sm p-4">
            {submission.status === 'graded' && status === 'ended' ? (
              <>
                <p className="text-lg font-bold text-foreground">
                  {submission.score ?? '—'} / {submission.max_score ?? '—'}
                  {submission.passed !== null && (
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${submission.passed ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                      {submission.passed ? t('assignment.pass') : t('assignment.fail')}
                    </span>
                  )}
                </p>
                {submission.rubric_scores && submission.rubric_scores.length > 0 && assignment.rubric && (
                  <div className="mt-3 space-y-1 border-t border-border pt-3">
                    {assignment.rubric.map((c) => {
                      const points = submission.rubric_scores!.find((r) => r.id === c.id)?.points ?? 0;
                      return (
                        <p key={c.id} className="text-sm text-muted-foreground">
                          {c.criterion}: <span className="font-medium text-foreground">{points}</span> / {c.max_points}
                        </p>
                      );
                    })}
                  </div>
                )}
                {submission.feedback && <p className="mt-2 text-sm text-muted-foreground">{submission.feedback}</p>}
                <Link href={`/learning-videos?mode=live&autostart=1&classId=${encodeURIComponent(assignment.class_id)}&assignmentId=${encodeURIComponent(assignment.id)}`} className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Study this with School Buddy</Link>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {status === 'active' ? t('assignment.resultsAfterEnd') : t('assignment.submittedAwaitingGrade')}
              </p>
            )}
          </div>
        ) : status === 'ended' ? (
          <div className="rounded-xl border border-border bg-card shadow-sm p-4">
            <p className="text-sm text-muted-foreground">{t('assignment.endedNoSubmission')}</p>
          </div>
        ) : isMcq ? (
          <div className="space-y-4">
            {assignment.questions!.map((question, qi) => (
              <div key={question.id} className="rounded-xl border border-border bg-card shadow-sm p-4">
                <p className="font-medium text-foreground">
                  {qi + 1}. {question.prompt}
                </p>
                <div className="mt-2 space-y-1">
                  {question.options.map((option, oi) => (
                    <label key={oi} className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="radio"
                        name={question.id}
                        checked={selected[question.id] === oi}
                        onChange={() => setSelected((prev) => ({ ...prev, [question.id]: oi }))}
                      />
                      {option}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {error && <p className="text-sm text-danger">{error}</p>}
            <button
              onClick={submit}
              disabled={!canSubmit || submitting}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
            >
              {submitting ? t('assignment.submitting') : t('assignment.submit')}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {writtenQuestions.length ? writtenQuestions.map((question, index) => <div key={`${question}-${index}`} className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="font-medium text-foreground">{question}</p><textarea value={writtenAnswers[index] ?? ''} onChange={(event) => setWrittenAnswers((current) => current.map((answer, answerIndex) => answerIndex === index ? event.target.value : answer))} rows={4} placeholder={t('assignment.writeYourAnswer')} className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" /></div>) : <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={6}
              placeholder={t('assignment.writeYourAnswer')}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />}
            {error && <p className="text-sm text-danger">{error}</p>}
            <button
              onClick={submit}
              disabled={!canSubmit || submitting}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
            >
              {submitting ? t('assignment.submitting') : t('assignment.submit')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface RosterStudent {
  id: string;
  full_name: string | null;
  email: string | null;
}

export function TeacherAssignmentView({
  assignment,
  contextLabel,
  roster,
  initialSubmissions,
  answerKey,
}: {
  assignment: AssignmentRow;
  contextLabel: string;
  roster: RosterStudent[];
  initialSubmissions: SubmissionRow[];
  answerKey?: AnswerKeyEntry[] | null;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [current, setCurrent] = useState(assignment);
  const [submissions, setSubmissions] = useState(initialSubmissions);
  const [gradingId, setGradingId] = useState<string | null>(null);
  const [showAnswers, setShowAnswers] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const submissionByStudent = new Map(submissions.map((s) => [s.student_id, s]));
  const answerById = new Map((answerKey ?? []).map((a) => [a.id, a]));

  const status = getEffectiveStatus(current);

  const setStatus = async (patch: Partial<Pick<AssignmentRow, 'status' | 'due_at'>>) => {
    const supabase = createClient();
    if (!supabase) return;
    setStatusSaving(true);
    const { data } = await supabase.from('assignments').update(patch).eq('id', current.id).select('*').single();
    setStatusSaving(false);
    if (data) setCurrent(data as AssignmentRow);
  };

  const reopen = () => {
    // A due date in the past would just read as "ended" again immediately,
    // so reopening past due clears it — set a new one from the assignment
    // if you want it to auto-end again.
    const pastDue = current.due_at && new Date(current.due_at) < new Date();
    setStatus({ status: 'active', ...(pastDue ? { due_at: null } : {}) });
  };

  const deleteAssignment = async () => {
    if (!window.confirm(t('assignment.deleteConfirm'))) return;
    const supabase = createClient();
    if (!supabase) return;
    const { error } = await supabase.from('assignments').delete().eq('id', current.id);
    if (!error) router.push('/assignments');
  };

  return (
    <div>
      <Header assignment={current} contextLabel={contextLabel} />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('assignment.status')}</span>
        {status === 'active' && (
          <button
            onClick={() => setStatus({ status: 'ended' })}
            disabled={statusSaving}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-50"
          >
            {t('assignment.endNow')}
          </button>
        )}
        {status === 'ended' && (
          <button
            onClick={reopen}
            disabled={statusSaving}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-50"
          >
            {t('assignment.reopen')}
          </button>
        )}
        {status !== 'cancelled' && (
          <button
            onClick={() => setStatus({ status: 'cancelled' })}
            disabled={statusSaving}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-50"
          >
            {t('form.cancel')}
          </button>
        )}
        {status === 'cancelled' && (
          <button
            onClick={reopen}
            disabled={statusSaving}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-50"
          >
            {t('assignment.reactivate')}
          </button>
        )}
        <button onClick={deleteAssignment} className="rounded-lg border border-danger/30 px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10">
          {t('assignment.deletePermanently')}
        </button>
      </div>

      {assignment.questions && assignment.questions.length > 0 && answerKey && answerKey.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowAnswers((v) => !v)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary"
          >
            {showAnswers ? t('assignment.hideAnswers') : t('assignment.showAnswers')}
          </button>
          {showAnswers && (
            <div className="mt-3 space-y-3">
              {assignment.questions.map((question, qi) => {
                const answer = answerById.get(question.id);
                return (
                  <div key={question.id} className="rounded-lg border border-border bg-card p-3">
                    <p className="text-sm font-medium text-foreground">
                      {qi + 1}. {question.prompt}
                    </p>
                    <div className="mt-2 space-y-1">
                      {question.options.map((option, oi) => (
                        <p
                          key={oi}
                          className={`text-sm ${
                            answer?.correct_index === oi ? 'font-semibold text-success' : 'text-muted-foreground'
                          }`}
                        >
                          {answer?.correct_index === oi ? '✓ ' : ''}
                          {option}
                        </p>
                      ))}
                    </div>
                    {answer?.explanation && <p className="mt-2 text-xs text-muted-foreground">{answer.explanation}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <h2 className="mt-8 text-lg font-bold text-foreground">{t('assignment.submissions')}</h2>
      <div className="mt-4 space-y-2">
        {roster.length === 0 && <p className="text-sm text-muted-foreground">{t('assignment.noStudentsEnrolled')}</p>}
        {roster.map((student) => {
          const submission = submissionByStudent.get(student.id);
          return (
            <div key={student.id} className="rounded-xl border border-border bg-card shadow-sm p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{student.full_name || student.email}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {!submission
                      ? t('assignment.notSubmitted')
                      : submission.status === 'graded'
                        ? `${t('assignment.graded')} — ${submission.score ?? '—'} / ${submission.max_score ?? '—'}${submission.passed !== null ? ` · ${submission.passed ? t('assignment.pass') : t('assignment.fail')}` : ''}`
                        : t('assignment.submittedAwaitingGrade')}
                  </p>
                </div>
                {submission && (
                  <button
                    onClick={() => setGradingId(gradingId === submission.id ? null : submission.id)}
                    className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary"
                  >
                    {gradingId === submission.id ? t('form.close') : submission.status === 'graded' ? t('assignment.editGrade') : t('assignment.grade')}
                  </button>
                )}
              </div>

              {submission && gradingId === submission.id && (
                <GradeForm
                  submission={submission}
                  maxScore={assignment.questions?.length ?? submission.max_score ?? undefined}
                  rubric={assignment.rubric}
                  onSaved={(updated) => {
                    setSubmissions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
                    setGradingId(null);
                  }}
                />
              )}

              {submission && submission.answers && 'text' in submission.answers && (
                <p className="mt-3 whitespace-pre-wrap rounded-lg bg-background p-3 text-sm text-muted-foreground">{submission.answers.text}</p>
              )}

              {submission && Array.isArray(submission.answers) && assignment.questions && (
                <div className="mt-3 space-y-2 rounded-lg bg-background p-3">
                  {assignment.questions.map((question, qi) => {
                    const given = (submission.answers as { id: string; selected_index: number }[]).find((a) => a.id === question.id);
                    const correctEntry = answerById.get(question.id);
                    const isCorrect = given !== undefined && correctEntry !== undefined && given.selected_index === correctEntry.correct_index;
                    return (
                      <div key={question.id} className="text-sm">
                        <p className="font-medium text-foreground">
                          {qi + 1}. {question.prompt}
                        </p>
                        <p className={isCorrect ? 'text-success' : 'text-danger'}>
                          {t('assignment.theirAnswer')}: {given !== undefined ? question.options[given.selected_index] : '—'}
                        </p>
                        {!isCorrect && correctEntry && (
                          <p className="text-muted-foreground">
                            {t('assignment.correctAnswer')}: {question.options[correctEntry.correct_index]}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GradeForm({
  submission,
  maxScore,
  rubric,
  onSaved,
}: {
  submission: SubmissionRow;
  maxScore: number | undefined;
  rubric?: RubricCriterion[] | null;
  onSaved: (updated: SubmissionRow) => void;
}) {
  const { t } = useLanguage();
  const hasRubric = !!rubric && rubric.length > 0;
  const [criterionPoints, setCriterionPoints] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    (rubric ?? []).forEach((c) => {
      initial[c.id] = submission.rubric_scores?.find((r) => r.id === c.id)?.points ?? 0;
    });
    return initial;
  });
  const rubricTotal = hasRubric ? Object.values(criterionPoints).reduce((sum, p) => sum + p, 0) : 0;
  const rubricMax = hasRubric ? rubric!.reduce((sum, c) => sum + c.max_points, 0) : 0;

  const [score, setScore] = useState(submission.score ?? 0);
  const [maxScoreValue, setMaxScoreValue] = useState(submission.max_score ?? maxScore ?? 0);
  const [passed, setPassed] = useState(submission.passed ?? true);
  const [feedback, setFeedback] = useState(submission.feedback ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [generating, setGenerating] = useState(false);
  const [suggestion, setSuggestion] = useState('');

  const generateFeedback = async () => {
    setGenerating(true); setError(undefined);
    const response = await fetch('/api/gemini/generate-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'assessment', score, maxScore: maxScoreValue, passed, answers: submission.answers }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(data.error ?? 'Could not generate feedback.');
    else { setFeedback(data.feedback ?? ''); setSuggestion(data.study_suggestion ?? ''); }
    setGenerating(false);
  };

  const save = async () => {
    const supabase = createClient();
    if (!supabase) return;
    setSaving(true);
    setError(undefined);
    const { data, error: updateError } = await supabase
      .from('submissions')
      .update({
        score: hasRubric ? rubricTotal : score,
        max_score: hasRubric ? rubricMax : maxScoreValue,
        passed,
        feedback: [feedback.trim(), suggestion.trim() ? `Study suggestion: ${suggestion.trim()}` : ''].filter(Boolean).join('\n\n') || null,
        status: 'graded',
        graded_at: new Date().toISOString(),
        rubric_scores: hasRubric ? rubric!.map((c) => ({ id: c.id, points: criterionPoints[c.id] ?? 0 })) : null,
      })
      .eq('id', submission.id)
      .select('*')
      .single();
    setSaving(false);
    if (updateError || !data) {
      setError(updateError?.message || 'Could not save grade.');
      return;
    }
    onSaved(data as SubmissionRow);
  };

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-border p-3">
      {hasRubric ? (
        <div className="space-y-2">
          {rubric!.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2">
              <label className="text-sm text-foreground">{c.criterion}</label>
              <div className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
                <input
                  type="number"
                  min={0}
                  max={c.max_points}
                  value={criterionPoints[c.id] ?? 0}
                  onChange={(event) =>
                    setCriterionPoints((prev) => ({ ...prev, [c.id]: Math.min(Number(event.target.value), c.max_points) }))
                  }
                  className="w-16 rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-primary"
                />
                <span>/ {c.max_points}</span>
              </div>
            </div>
          ))}
          <p className="text-sm font-semibold text-foreground">
            {t('assignment.total')}: {rubricTotal} / {rubricMax}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            value={score}
            onChange={(event) => setScore(Number(event.target.value))}
            placeholder={t('assignment.score')}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
          <input
            type="number"
            value={maxScoreValue}
            onChange={(event) => setMaxScoreValue(Number(event.target.value))}
            placeholder={t('assignment.outOf')}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setPassed(true)}
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${passed ? 'border-transparent bg-success/10 text-success' : 'border-border text-muted-foreground'}`}
        >
          {t('assignment.pass')}
        </button>
        <button
          type="button"
          onClick={() => setPassed(false)}
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${!passed ? 'border-transparent bg-danger/10 text-danger' : 'border-border text-muted-foreground'}`}
        >
          {t('assignment.fail')}
        </button>
      </div>
      <textarea
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
        rows={2}
        placeholder={t('assignment.feedbackOptional')}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
      />
      <button type="button" onClick={() => void generateFeedback()} disabled={generating} className="rounded-lg border border-primary px-4 py-2 text-sm font-semibold text-primary disabled:opacity-50">{generating ? 'Generating…' : 'Suggest feedback with School Buddy'}</button>
      {suggestion && <p className="rounded-lg bg-primary/5 p-3 text-sm text-foreground"><strong>Study suggestion:</strong> {suggestion}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        onClick={save}
        disabled={saving}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
      >
        {saving ? t('form.saving') : t('assignment.saveGrade')}
      </button>
    </div>
  );
}
