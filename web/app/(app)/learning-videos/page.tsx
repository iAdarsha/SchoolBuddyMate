import { redirect } from 'next/navigation';
import LearningVideosClient from '@/components/videos/LearningVideosClient';
import type { LearningVideo } from '@shared/domain/learning';
import { getUserAndProfile } from '@/lib/supabase/profile';
import { createClient } from '@/lib/supabase/server';

export default async function LearningVideosPage({ searchParams }: { searchParams: Promise<{ mode?: string; autostart?: string; classId?: string; assignmentId?: string }> }) {
  const { user, profile } = await getUserAndProfile();
  if (!user || !profile) redirect('/login');
  const supabase = await createClient();
  if (!supabase) redirect('/dashboard');

  let classQuery = supabase.from('classes').select('id, name, teacher_id, class_groups(name)').order('name');
  if (profile.role === 'teacher') classQuery = classQuery.eq('teacher_id', user.id);
  const { data: classRows } = await classQuery;
  const classes = ((classRows ?? []) as unknown as Array<{ id: string; name: string; teacher_id: string; class_groups: { name: string } | null }>).map((row) => ({
    id: row.id,
    label: [row.class_groups?.name, row.name].filter(Boolean).join(' · '),
  }));

  const [{ data: videoRows }, { data: progressRows }] = await Promise.all([
    supabase.from('learning_videos').select('*, classes(name, class_groups(name))').order('created_at', { ascending: false }),
    supabase.from('video_progress').select('*'),
  ]);
  const { data: materialRows } = profile.role === 'student'
    ? await supabase.from('materials').select('id, class_id, title, chapter, video_url').eq('status', 'extracted').order('created_at', { ascending: true })
    : { data: [] };
  const progress = (progressRows ?? []) as Array<{ video_id: string; student_id: string; completed: boolean; position_seconds: number; updated_at: string }>;
  const videos = ((videoRows ?? []) as unknown as Array<LearningVideo & { classes: { name: string; class_groups: { name: string } | null } | null }>).map((video) => ({
    ...video,
    classLabel: [video.classes?.class_groups?.name, video.classes?.name].filter(Boolean).join(' · '),
    completedCount: progress.filter((item) => item.video_id === video.id && item.completed).length,
    studentProgress: progress.find((item) => item.video_id === video.id && item.student_id === user.id) ?? null,
  }));

  const params = await searchParams;
  const requestedMode = params.mode === 'live' ? 'live' : 'video';
  return <LearningVideosClient role={profile.role} userId={user.id} initialVideos={videos} classes={classes} initialMaterials={(materialRows ?? []) as Array<{ id: string; class_id: string; title: string; chapter: string | null; video_url: string | null }>} initialMode={requestedMode} autoStart={params.autostart === '1'} initialClassId={params.classId} assignmentId={params.assignmentId} />;
}
