import Link from 'next/link';
import { getEffectiveStatus } from '@/components/assignments/types';
import DashboardBanner, { TILE_PALETTE } from '@/components/dashboard/DashboardBanner';
import { AnimatedBarChart, DashboardPanel, ProgressBreakdown } from '@/components/dashboard/DashboardWidgets';
import { fetchTeacherClassGroups } from '@/lib/classGroups';
import { getServerT } from '@/lib/i18n/server';
import { createClient } from '@/lib/supabase/server';

function formatDue(dueAt: string | null): { label: string; status: 'danger' | 'warning' | 'info' } {
  if (!dueAt) return { label: 'No due date', status: 'info' };
  const due = new Date(dueAt);
  const now = new Date();
  const diffDays = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return { label: 'Overdue', status: 'danger' };
  if (diffDays < 1) return { label: 'Due today', status: 'warning' };
  if (diffDays < 2) return { label: 'Due tomorrow', status: 'warning' };
  return { label: due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), status: 'info' };
}

const STATUS_COLOR = { danger: 'bg-danger', warning: 'bg-warning', info: 'bg-info' } as const;

export default async function TeacherDashboard({ name, userId }: { name: string; userId: string }) {
  const supabase = await createClient();
  const t = await getServerT();

  const classes = supabase ? await fetchTeacherClassGroups(supabase, userId) : [];

  const { data: subjectRow } = supabase
    ? await supabase.from('subjects').select('name').eq('teacher_id', userId).maybeSingle()
    : { data: null };

  const { data: offeringRows } = supabase
    ? await supabase.from('classes').select('id').eq('teacher_id', userId)
    : { data: null };
  const classIds = (offeringRows ?? []).map((c) => c.id);
  const studentCount = classes.reduce((sum, c) => sum + c.studentCount, 0);

  interface AssignmentRow {
    id: string;
    title: string;
    due_at: string | null;
    status: 'active' | 'ended' | 'cancelled';
    classes: { name: string } | null;
  }
  const { data: assignmentRows } = supabase && classIds.length
    ? await supabase
        .from('assignments')
        .select('id, title, due_at, status, classes(name)')
        .in('class_id', classIds)
        .order('due_at', { ascending: true, nullsFirst: false })
    : { data: [] };
  // Cancelled assignments are voided — don't count them as due/overdue.
  const assignments = ((assignmentRows ?? []) as unknown as AssignmentRow[]).filter((a) => getEffectiveStatus(a) !== 'cancelled');
  const { data: submissionRows } = supabase
    ? await supabase.from('submissions').select('status')
    : { data: [] };
  const submissions = submissionRows ?? [];
  const gradedSubmissions = submissions.filter((row) => row.status === 'graded').length;

  const now = new Date();
  const dueSoonCount = (assignments ?? []).filter((a) => {
    if (!a.due_at) return false;
    const diffDays = (new Date(a.due_at).getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays < 7;
  }).length;

  const stats = [
    { label: t('dashboard.statClasses'), value: String(classes?.length ?? 0) },
    { label: t('dashboard.statStudents'), value: String(studentCount) },
    { label: t('dashboard.statDueThisWeek'), value: String(dueSoonCount) },
    { label: t('dashboard.statTotalAssignments'), value: String(assignments?.length ?? 0) },
  ];

  const upcoming = (assignments ?? []).slice(0, 4);
  const classCount = classes?.length ?? 0;

  return (
    <>
      <DashboardBanner
        eyebrow={t('dashboard.welcomeBack')}
        name={name}
        subtitle={subjectRow?.name ? t('dashboard.subjectTeacherSuffix', { subject: subjectRow.name }) : undefined}
        summary={
          classCount > 0
            ? t('dashboard.teachingSummary', { students: String(studentCount), classes: String(classCount) })
            : t('dashboard.classesWillShowUp')
        }
        actions={
          <>
            <Link href="/classes" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground">
              {t('dashboard.viewClasses')}
            </Link>
            <Link href="/assignments" className="rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold text-primary-foreground">
              {t('dashboard.viewAssignments')}
            </Link>
            <Link href="/live-reports" className="rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold text-primary-foreground">
              Review live reports
            </Link>
          </>
        }
      />

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat, i) => {
          const tile = TILE_PALETTE[i % TILE_PALETTE.length];
          return (
            <div key={stat.label} className={`rounded-xl ${tile.bg} p-4`}>
              <p className={`text-2xl font-bold ${tile.text}`}>{stat.value}</p>
              <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
        <DashboardPanel title="Class reach" subtitle="Students in each class" action={{ href: '/classes', label: t('dashboard.viewClasses') }}>
          <AnimatedBarChart data={classes.map((item) => ({ label: item.name, value: item.studentCount }))} valueLabel="Number of students in each class" />
        </DashboardPanel>
        <DashboardPanel title="Grading progress" subtitle="Submission status across your classes">
          <ProgressBreakdown items={[
            { label: 'Graded', value: gradedSubmissions, total: submissions.length, tone: 'success' },
            { label: 'Awaiting grade', value: submissions.length - gradedSubmissions, total: submissions.length, tone: 'warning' },
            { label: 'Assignments due soon', value: dueSoonCount, total: assignments.length, tone: 'info' },
          ]} />
        </DashboardPanel>
      </div>

      <h2 className="mt-10 mb-4 text-lg font-bold text-foreground">{t('dashboard.yourClasses')}</h2>
      <div className="space-y-2">
        {(classes ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t('dashboard.noClassesYetTeacher')}</p>}
        {classes.map((classItem, i) => {
          const tile = TILE_PALETTE[i % TILE_PALETTE.length];
          return (
            <Link
              key={classItem.id}
              href={classItem.offeringId ? `/classes/${classItem.id}/subjects/${classItem.offeringId}` : `/classes/${classItem.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card shadow-sm p-4 hover:border-primary"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${tile.bg} ${tile.text}`}>
                  {classItem.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{classItem.name}</p>
                </div>
              </div>
              <p className="shrink-0 text-sm text-muted-foreground">{classItem.studentCount} students</p>
            </Link>
          );
        })}
      </div>

      <h2 className="mt-10 mb-4 text-lg font-bold text-foreground">{t('dashboard.upcomingAssignments')}</h2>
      <div className="space-y-2">
        {upcoming.length === 0 && <p className="text-sm text-muted-foreground">{t('dashboard.noAssignmentsYet')}</p>}
        {upcoming.map((assignment) => {
          const due = formatDue(assignment.due_at);
          return (
            <div key={assignment.id} className="flex items-center gap-3 rounded-xl border border-border bg-card shadow-sm p-4">
              <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_COLOR[due.status]}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-foreground">{assignment.title}</p>
                <p className="mt-1 truncate text-sm text-muted-foreground">{assignment.classes?.name}</p>
              </div>
              <p className="shrink-0 text-sm text-muted-foreground">{due.label}</p>
            </div>
          );
        })}
      </div>
    </>
  );
}
