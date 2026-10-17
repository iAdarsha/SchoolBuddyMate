import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/supabase/request';
import { isRecord, isUuid } from '@shared/domain/requests';

const heygenApiKey = process.env.HEYGEN_API_KEY;
const heygenBaseUrl = 'https://api.heygen.com';

async function heygen(path: string, init?: RequestInit) {
  return fetch(`${heygenBaseUrl}${path}`, {
    ...init,
    headers: { 'X-Api-Key': heygenApiKey ?? '', 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (auth.profile.role !== 'teacher') return NextResponse.json({ error: 'Teachers only.' }, { status: 403 });
  if (!heygenApiKey) return NextResponse.json({ error: 'HeyGen is not configured on the server.' }, { status: 500 });

  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || !isUuid(body.classId) || typeof body.topic !== 'string' || !body.topic.trim() ||
      typeof body.objectives !== 'string' || !body.objectives.trim() || typeof body.style !== 'string' ||
      typeof body.avatarId !== 'string' || !body.avatarId || typeof body.voiceId !== 'string' || !body.voiceId ||
      typeof body.duration !== 'number' || !Number.isInteger(body.duration) || body.duration < 1 || body.duration > 15 ||
      typeof body.language !== 'string') {
    return NextResponse.json({ error: 'Complete the class, topic, objectives, style, duration, and language fields.' }, { status: 400 });
  }

  const { data: classRow } = await auth.supabase.from('classes').select('id, name, class_groups(name)').eq('id', body.classId).eq('teacher_id', auth.user.id).single();
  if (!classRow) return NextResponse.json({ error: 'You can only create videos for your own classes.' }, { status: 403 });

  const prompt = `Create an educational lesson video for ${classRow.name}. Topic: ${body.topic.trim()}. Learning objectives: ${body.objectives.trim()}. Teaching style: ${body.style}. Target length: ${body.duration} minutes. Language: ${body.language}. Use the selected presenter and voice. Structure the lesson with an introduction, explanation, and short recap. Keep the content suitable for school students.`;
  const response = await heygen('/v3/video-agents', { method: 'POST', body: JSON.stringify({ prompt, avatar_id: body.avatarId, voice_id: body.voiceId }) });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(result) && typeof result.message === 'string' ? result.message : isRecord(result) && isRecord(result.error) && typeof result.error.message === 'string' ? result.error.message : 'HeyGen could not start the video.';
    return NextResponse.json({ error: message, details: result }, { status: 502 });
  }

  const data = isRecord(result) && isRecord(result.data) ? result.data : null;
  if (!data || typeof data.session_id !== 'string') return NextResponse.json({ error: 'HeyGen returned an invalid generation session.' }, { status: 502 });
  return NextResponse.json({ sessionId: data.session_id, status: typeof data.status === 'string' ? data.status : 'generating' });
}

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (auth.profile.role !== 'teacher') return NextResponse.json({ error: 'Teachers only.' }, { status: 403 });
  if (!heygenApiKey) return NextResponse.json({ error: 'HeyGen is not configured on the server.' }, { status: 500 });
  const sessionId = new URL(request.url).searchParams.get('sessionId');
  if (!sessionId || sessionId.length > 256 || !/^[A-Za-z0-9_-]+$/.test(sessionId)) return NextResponse.json({ error: 'Invalid session.' }, { status: 400 });

  const sessionResponse = await heygen(`/v3/video-agents/${encodeURIComponent(sessionId)}`);
  const sessionResult: unknown = await sessionResponse.json().catch(() => null);
  const sessionData = isRecord(sessionResult) && isRecord(sessionResult.data) ? sessionResult.data : null;
  if (!sessionResponse.ok || !sessionData) {
    const message = isRecord(sessionResult) && typeof sessionResult.message === 'string' ? sessionResult.message : 'Could not read the HeyGen generation status.';
    return NextResponse.json({ error: message, details: sessionResult }, { status: 502 });
  }
  if (typeof sessionData.video_id !== 'string') return NextResponse.json({ status: typeof sessionData.status === 'string' ? sessionData.status : 'generating' });

  const videoResponse = await heygen(`/v3/videos/${encodeURIComponent(sessionData.video_id)}`);
  const videoResult: unknown = await videoResponse.json().catch(() => null);
  const videoData = isRecord(videoResult) && isRecord(videoResult.data) ? videoResult.data : null;
  if (!videoResponse.ok || !videoData) {
    const message = isRecord(videoResult) && typeof videoResult.message === 'string' ? videoResult.message : 'Could not read the HeyGen video status.';
    return NextResponse.json({ error: message, details: videoResult }, { status: 502 });
  }
  return NextResponse.json({ status: typeof videoData.status === 'string' ? videoData.status : 'generating', videoId: sessionData.video_id, videoUrl: typeof videoData.video_url === 'string' ? videoData.video_url : null, duration: typeof videoData.duration === 'number' ? videoData.duration : null, failureCode: typeof videoData.failure_code === 'string' ? videoData.failure_code : null, failureMessage: typeof videoData.failure_message === 'string' ? videoData.failure_message : null });
}
