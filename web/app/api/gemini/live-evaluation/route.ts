import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/supabase/request';

const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_LIVE_API_KEY;

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (!apiKey) return NextResponse.json({ error: 'Gemini evaluation is not configured.' }, { status: 500 });
  const body = await request.json().catch(() => ({})) as { classId?: string; transcript?: Array<{ speaker?: string; text?: string }> };
  const transcript = Array.isArray(body.transcript) ? body.transcript.filter((item) => item?.text).map((item) => `${item.speaker}: ${item.text}`).join('\n').slice(-12000) : '';
  if (!transcript) return NextResponse.json({ error: 'A transcript is required.' }, { status: 400 });

  let lessonContext = 'No lesson context was supplied.';
  if (body.classId) {
    const { data: materials } = await auth.supabase.from('materials').select('title, chapter, extracted_text').eq('class_id', body.classId).eq('status', 'extracted').limit(8);
    lessonContext = (materials ?? []).map((item) => `${item.title}${item.chapter ? ` (${item.chapter})` : ''}\n${item.extracted_text ?? ''}`).join('\n\n').slice(0, 14000) || lessonContext;
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: `Evaluate this student learning conversation against the supplied lesson context. Ignore greetings and casual conversation. Return ONLY valid JSON with this exact shape: {"understanding_score": number 0-100, "topic": string, "questions_asked": number, "answers_given": number, "correct_signals": number, "needs_revision": boolean, "strengths": string[], "misconceptions": string[], "recommended_actions": string[], "recommended_assessment": "none"|"quiz"|"test"|"exam", "assessment_reason": string, "evidence": [{"question": string, "answer": string, "judgement": "correct"|"partial"|"incorrect"|"unclear", "feedback": string}]}. Judge answer correctness from the lesson context and conversation, not from keywords.\n\nLESSON CONTEXT:\n${lessonContext}\n\nCONVERSATION:\n${transcript}` }] }] }),
  });
  const data = await response.json().catch(() => null) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } } | null;
  if (!response.ok) return NextResponse.json({ error: data?.error?.message ?? 'Gemini could not evaluate the lesson.' }, { status: 502 });
  const text = data?.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text?.replace(/^```json\s*|\s*```$/g, '').trim();
  try {
    return NextResponse.json({ evaluation: JSON.parse(text ?? '') });
  } catch {
    return NextResponse.json({ error: 'Gemini returned an invalid evaluation.' }, { status: 502 });
  }
}
