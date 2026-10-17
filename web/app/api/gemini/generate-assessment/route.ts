import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/supabase/request';

// Draft assessments use the normal text-generation key. Live voice credentials
// are intentionally not used by this route.
const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth || auth.profile?.role !== 'teacher') return NextResponse.json({ error: 'Teacher access required.' }, { status: 403 });
  if (!apiKey) return NextResponse.json({ error: 'Gemini is not configured.' }, { status: 500 });
  const body = await request.json().catch(() => ({})) as { studentName?: string; className?: string; topic?: string; score?: number; evidence?: unknown };
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: `Create a teacher-reviewable assessment draft for ${body.studentName || 'a student'} in ${body.className || 'this class'}. Return ONLY JSON: {"title":string,"description":string,"assessment_type":"homework"|"test"|"revision","difficulty":"easy"|"medium"|"expert","suggested_feedback":string,"questions":[{"type":"multiple_choice"|"short_answer","question":string,"options":[string,string,string,string],"correct_index":number,"answer":string,"points":number}],"reason":string}. Prefer multiple choice, but include short_answer questions when they better test explanation or reasoning. The suggested_feedback must be an encouraging teacher message that explains what the student should practise based on the evidence; it must be editable and suitable for either question type. Use the topic, score, and evidence below. Target the student's misconceptions, but keep it age-appropriate.\nTopic: ${body.topic || 'lesson understanding'}\nScore: ${body.score ?? 0}\nEvidence: ${JSON.stringify(body.evidence ?? {})}` }] }] }),
  });
  const data = await response.json().catch(() => null) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } } | null;
  const text = data?.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text?.replace(/^```json\s*|\s*```$/g, '').trim();
  try { return NextResponse.json({ draft: JSON.parse(text ?? '') }); } catch { return NextResponse.json({ error: data?.error?.message ?? 'Gemini returned an invalid assessment draft.' }, { status: 502 }); }
}
