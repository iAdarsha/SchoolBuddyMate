import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/supabase/request';

const key = process.env.HEYGEN_API_KEY;

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (auth.profile.role !== 'teacher') return NextResponse.json({ error: 'Teachers only.' }, { status: 403 });
  if (!key) return NextResponse.json({ error: 'HeyGen is not configured.' }, { status: 500 });
  const headers = { 'X-Api-Key': key };
  const [avatarsResponse, voicesResponse] = await Promise.all([
    fetch('https://api.heygen.com/v2/avatars', { headers }),
    fetch('https://api.heygen.com/v2/voices', { headers }),
  ]);
  const avatars = await avatarsResponse.json().catch(() => null);
  const voices = await voicesResponse.json().catch(() => null);
  if (!avatarsResponse.ok || !voicesResponse.ok) return NextResponse.json({ error: 'Could not load HeyGen avatars and voices.' }, { status: 502 });
  const avatarList = Array.isArray(avatars?.data) ? avatars.data : avatars?.data?.avatars ?? avatars?.data?.avatar_list ?? avatars?.data?.items ?? avatars?.avatars ?? avatars?.avatar_list ?? [];
  const voiceList = Array.isArray(voices?.data) ? voices.data : voices?.data?.voices ?? voices?.data?.voice_list ?? voices?.data?.items ?? voices?.voices ?? voices?.voice_list ?? [];
  if (!avatarList.length || !voiceList.length) return NextResponse.json({ error: 'HeyGen returned no avatars or voices. Check that this API key has permission to list avatar and voice resources.' }, { status: 502 });
  return NextResponse.json({
    avatars: avatarList.map((item: Record<string, unknown>) => ({ avatar_id: item.avatar_id ?? item.id, avatar_name: item.avatar_name ?? item.name ?? item.display_name ?? 'Unnamed avatar' })).filter((item: { avatar_id?: unknown }) => typeof item.avatar_id === 'string'),
    voices: voiceList.map((item: Record<string, unknown>) => ({ voice_id: item.voice_id ?? item.id, name: item.name ?? item.display_name ?? 'Unnamed voice', language: item.language ?? item.language_name })).filter((item: { voice_id?: unknown }) => typeof item.voice_id === 'string'),
  });
}
