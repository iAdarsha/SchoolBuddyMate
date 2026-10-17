import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/supabase/request';

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth || auth.profile?.role !== 'teacher') return NextResponse.json({ error: 'Teacher access required.' }, { status: 403 });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: 'Gemini is not configured.' }, { status: 500 });
  const body = await request.json().catch(() => ({})) as { title?: string; score?: number; maxScore?: number; passed?: boolean; answers?: unknown };
  const prompt = `Write concise, encouraging teacher feedback for a student. Return only JSON: {"feedback": string, "study_suggestion": string}. Mention what to review based on the result, avoid inventing details, and do not sound punitive. Assessment: ${body.title || 'School Buddy assessment'}. Score: ${body.score ?? 0}/${body.maxScore ?? 0}. Passed: ${body.passed ? 'yes' : 'no'}. Answer evidence: ${JSON.stringify(body.answers ?? {})}`;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.GEMINI_MODEL || 'gemini-3.8-flash')}:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }) });
  const data = await response.json().catch(() => null) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } } | null;
  const text = data?.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text?.replace(/^```json\s*|\s*```$/g, '').trim();
  try { return NextResponse.json(JSON.parse(text ?? '')); } catch { return NextResponse.json({ error: data?.error?.message ?? 'Could not generate feedback.' }, { status: 502 }); }
}
