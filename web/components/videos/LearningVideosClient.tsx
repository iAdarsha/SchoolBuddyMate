'use client';

import { useMemo, useState, type FormEvent } from 'react';
import type { LearningVideo } from '@shared/domain/learning';
import { getVideoEmbedUrl, isSafeVideoUrl } from '@shared/domain/learning';
import type { Role } from '@shared/domain/profile';
import { CheckIcon, PlayCircleIcon, PlusIcon, TrashIcon, XIcon } from '@/components/icons';
import { createClient } from '@/lib/supabase/client';

interface ClassOption { id: string; label: string }
interface ProgressView { video_id: string; student_id: string; completed: boolean; position_seconds: number; updated_at: string }
interface VideoView extends LearningVideo { classLabel: string; completedCount: number; studentProgress?: ProgressView | null }

function formatDuration(minutes: number | null) {
  if (!minutes) return 'Self-paced';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

export default function LearningVideosClient({
  role,
  userId,
  initialVideos,
  classes,
}: {
  role: Role;
  userId: string;
  initialVideos: VideoView[];
  classes: ClassOption[];
}) {
  const canManage = role === 'teacher';
  const canTrack = role === 'student';
  const [videos, setVideos] = useState(initialVideos);
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [activeVideoId, setActiveVideoId] = useState(initialVideos[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [duration, setDuration] = useState('');
  const [description, setDescription] = useState('');
  const [generationTopic, setGenerationTopic] = useState('');
  const [generationObjectives, setGenerationObjectives] = useState('');
  const [generationStyle, setGenerationStyle] = useState('clear and engaging');
  const [generationDuration, setGenerationDuration] = useState('3');
  const [generationLanguage, setGenerationLanguage] = useState('English');
  const activeVideo = useMemo(() => videos.find((item) => item.id === activeVideoId) ?? videos[0], [activeVideoId, videos]);
  const embedUrl = activeVideo ? getVideoEmbedUrl(activeVideo.video_url) : null;

  const createVideo = async (event: FormEvent) => {
    event.preventDefault();
    if (!classId || !title.trim() || !isSafeVideoUrl(videoUrl)) {
      setError('Use a valid HTTPS YouTube or Vimeo link.');
      return;
    }
    const supabase = createClient();
    if (!supabase) return;
    setSaving(true);
    setError(undefined);
    const payload = {
      class_id: classId,
      created_by: userId,
      title: title.trim(),
      description: description.trim() || null,
      video_url: videoUrl.trim(),
      duration_minutes: duration ? Number(duration) : null,
      published: false,
    };
    const { data, error: createError } = await supabase.from('learning_videos').insert(payload).select('*').single();
    setSaving(false);
    if (createError || !data) {
      setError(createError?.message ?? 'Could not create learning video.');
      return;
    }
    const nextVideo: VideoView = {
      ...(data as LearningVideo),
      classLabel: classes.find((item) => item.id === classId)?.label ?? '',
      completedCount: 0,
      studentProgress: null,
    };
    setVideos((current) => [nextVideo, ...current]);
    setActiveVideoId(nextVideo.id);
    setTitle('');
    setVideoUrl('');
    setDuration('');
    setDescription('');
    setCreating(false);
  };

  const togglePublished = async (video: VideoView) => {
    const supabase = createClient();
    if (!supabase) return;
    const published = !video.published;
    const { error: updateError } = await supabase.from('learning_videos').update({ published, updated_at: new Date().toISOString() }).eq('id', video.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setVideos((current) => current.map((item) => item.id === video.id ? { ...item, published } : item));
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this learning video?')) return;
    const supabase = createClient();
    if (!supabase) return;
    const { error: deleteError } = await supabase.from('learning_videos').delete().eq('id', id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setVideos((current) => current.filter((item) => item.id !== id));
    if (activeVideoId === id) setActiveVideoId('');
  };

  const markComplete = async (video: VideoView, completed: boolean) => {
    const supabase = createClient();
    if (!supabase) return;
    const progress = {
      video_id: video.id,
      student_id: userId,
      completed,
      position_seconds: 0,
      updated_at: new Date().toISOString(),
    };
    const { error: progressError } = await supabase.from('video_progress').upsert(progress, { onConflict: 'video_id,student_id' });
    if (progressError) {
      setError(progressError.message);
      return;
    }
    setVideos((current) => current.map((item) => item.id === video.id ? { ...item, studentProgress: progress } : item));
  };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Learning Videos</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {canManage ? 'Share YouTube or Vimeo lessons with your classes and watch completion.' : 'Watch published class lessons and track your progress.'}
          </p>
        </div>
        {canManage && <div className="flex flex-wrap gap-2">
          <button onClick={() => setGenerating((value) => !value)} disabled={!classes.length} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">
            <PlayCircleIcon width={16} /> Create with AI
          </button>
          <button onClick={() => setCreating(true)} disabled={!classes.length} className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-40">
            <PlusIcon width={16} /> Add existing video
          </button>
        </div>}
      </div>

      {canManage && generating && (
        <section className="mt-6 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card shadow-sm">
          <div className="border-b border-primary/10 px-5 py-5 sm:px-6">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">HeyGen Video Agent</p>
            <h2 className="mt-1 text-xl font-bold text-foreground">Create a lesson video for your class</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Describe the lesson and HeyGen will create a narrated presenter video. It will stay private until you publish it.</p>
          </div>
          <form onSubmit={(event) => { event.preventDefault(); setError('HeyGen generation is ready for API connection. Add HEYGEN_API_KEY to enable video creation.'); }} className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-6">
            <label className="text-sm font-semibold text-foreground">Class
              <select value={classId} onChange={(event) => setClassId(event.target.value)} className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 font-normal">
                {classes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold text-foreground">Lesson topic
              <input value={generationTopic} onChange={(event) => setGenerationTopic(event.target.value)} required placeholder="e.g. Photosynthesis" className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 font-normal" />
            </label>
            <label className="text-sm font-semibold text-foreground sm:col-span-2">Learning objectives
              <textarea value={generationObjectives} onChange={(event) => setGenerationObjectives(event.target.value)} required rows={3} placeholder="What should students understand by the end?" className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 font-normal" />
            </label>
            <label className="text-sm font-semibold text-foreground">Teaching style
              <select value={generationStyle} onChange={(event) => setGenerationStyle(event.target.value)} className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 font-normal">
                <option>clear and engaging</option><option>formal classroom lecture</option><option>friendly and visual</option><option>exam revision</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm font-semibold text-foreground">Minutes
                <input type="number" min={1} max={15} value={generationDuration} onChange={(event) => setGenerationDuration(event.target.value)} className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 font-normal" />
              </label>
              <label className="text-sm font-semibold text-foreground">Language
                <select value={generationLanguage} onChange={(event) => setGenerationLanguage(event.target.value)} className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 font-normal"><option>English</option><option>Hindi</option><option>Telugu</option><option>Spanish</option></select>
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 sm:col-span-2">
              <button type="button" onClick={() => setGenerating(false)} className="rounded-lg px-4 py-2 text-sm font-semibold text-muted-foreground">Cancel</button>
              <button disabled={!generationTopic.trim() || !generationObjectives.trim()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">Generate lesson video</button>
            </div>
          </form>
        </section>
      )}

      {error && <p className="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</p>}

      {creating && (
        <form onSubmit={createVideo} className="mt-6 rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-foreground">New learning video</h2>
            <button type="button" onClick={() => setCreating(false)} className="rounded-lg p-1 text-muted-foreground hover:bg-background"><XIcon width={16} /></button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <select value={classId} onChange={(event) => setClassId(event.target.value)} required className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
              {classes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={160} placeholder="Video title" className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            <input value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} required placeholder="https://youtube.com/watch?v=..." className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            <input type="number" min={1} max={1440} value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="Duration in minutes" className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} rows={3} placeholder="What should students focus on?" className="sm:col-span-2 rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          </div>
          <button disabled={saving} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {saving ? 'Saving...' : 'Save draft'}
          </button>
        </form>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <section className="min-w-0">
          {activeVideo && (
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="aspect-video bg-black">
                {embedUrl ? (
                  <iframe className="h-full w-full" src={embedUrl} title={activeVideo.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-white/70">Preview unavailable for this link.</div>
                )}
              </div>
              <div className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-primary">{activeVideo.classLabel}</p>
                    <h2 className="mt-1 text-xl font-bold text-foreground">{activeVideo.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{formatDuration(activeVideo.duration_minutes)}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${activeVideo.published ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
                    {activeVideo.published ? 'Published' : 'Draft'}
                  </span>
                </div>
                {activeVideo.description && <p className="mt-4 whitespace-pre-wrap text-sm text-muted-foreground">{activeVideo.description}</p>}
                {canTrack && (
                  <button onClick={() => markComplete(activeVideo, !activeVideo.studentProgress?.completed)} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                    <CheckIcon width={16} /> {activeVideo.studentProgress?.completed ? 'Mark incomplete' : 'Mark complete'}
                  </button>
                )}
              </div>
            </div>
          )}
          {!activeVideo && <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">No learning videos to show yet.</div>}
        </section>

        <aside className="space-y-3">
          {videos.map((video) => (
            <article key={video.id} className={`rounded-xl border bg-card p-4 shadow-sm transition ${activeVideo?.id === video.id ? 'border-primary' : 'border-border'}`}>
              <button onClick={() => setActiveVideoId(video.id)} className="flex w-full items-start gap-3 text-left">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary"><PlayCircleIcon width={18} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-foreground">{video.title}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{video.classLabel} · {formatDuration(video.duration_minutes)}</span>
                  {canManage && <span className="mt-1 block text-xs text-muted-foreground">{video.completedCount} completed</span>}
                  {canTrack && video.studentProgress?.completed && <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-1 text-xs font-semibold text-success"><CheckIcon width={12} /> Done</span>}
                </span>
              </button>
              {canManage && (
                <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                  <button onClick={() => togglePublished(video)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">
                    {video.published ? 'Unpublish' : 'Publish'}
                  </button>
                  <button onClick={() => remove(video.id)} className="ml-auto rounded p-2 text-muted-foreground hover:text-danger"><TrashIcon width={15} /></button>
                </div>
              )}
            </article>
          ))}
        </aside>
      </div>
    </main>
  );
}
