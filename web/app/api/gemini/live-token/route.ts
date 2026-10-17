import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/supabase/request';

const geminiApiKey = process.env.GEMINI_LIVE_API_KEY || process.env.GEMINI_API_KEY;
const liveModel = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (!geminiApiKey) return NextResponse.json({ error: 'School Buddy Live Session is not configured.' }, { status: 500 });

  const body = await request.json().catch(() => ({})) as { classId?: string; assignmentId?: string; voiceName?: string; language?: string; voiceStyle?: string; previousTranscript?: Array<{ speaker?: string; text?: string }> };
  const voiceName = body.voiceName || 'Kore';
  const language = body.language || 'English';
  const voiceStyle = body.voiceStyle || 'Friendly tutor';
  const previousTranscript = Array.isArray(body.previousTranscript) ? body.previousTranscript.filter((item) => item && typeof item.text === 'string').map((item) => `${item.speaker === 'School Buddy' ? 'School Buddy' : 'Student'}: ${item.text}`).join('\n').slice(-6000) : '';
  let lessonContext = 'No specific class or course was selected. Ask the student which School Buddy subject they are studying.';
  let learningContext = '';
  const { data: latestEvaluation } = await auth.supabase.from('live_learning_evaluations').select('topic, understanding_score, needs_revision, strengths, recommended_actions, evidence, updated_at').eq('student_id', auth.user.id).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  const { data: recentFeedback } = await auth.supabase.from('submissions').select('assignment_id, score, max_score, passed, feedback, graded_at, assignments(title)').eq('student_id', auth.user.id).eq('status', 'graded').order('graded_at', { ascending: false }).limit(3);
  if (latestEvaluation || recentFeedback?.length) {
    learningContext = `\n\nPRIVATE STUDENT LEARNING CONTEXT (use gently for personalised teaching; never expose database details):\n${JSON.stringify({ latestEvaluation, recentFeedback })}\nAcknowledge prior difficulties when relevant, ask the student to practise weak areas, and give encouragement. Do not claim a score unless the student asks about their progress.`;
  }
  if (body.assignmentId) {
    const { data: assignment } = await auth.supabase.from('assignments').select('id, title, description, class_id').eq('id', body.assignmentId).maybeSingle();
    const { data: submission } = await auth.supabase.from('submissions').select('score, max_score, passed, feedback, graded_at').eq('assignment_id', body.assignmentId).eq('student_id', auth.user.id).maybeSingle();
    if (assignment) learningContext += `\n\nREVISION TASK REQUESTED BY THE STUDENT:\n${JSON.stringify({ assignment, submission })}\nUse this assignment and its feedback as the immediate revision goal. Ask the student to explain the missed concept and practise it step by step.`;
  }
  if (body.classId) {
    const { data: classRow } = await auth.supabase.from('classes').select('name, subjects(name), class_groups(name)').eq('id', body.classId).maybeSingle();
    if (classRow) {
      const { data: materials } = await auth.supabase.from('materials').select('title, chapter, extracted_text').eq('class_id', body.classId).eq('status', 'extracted').order('created_at', { ascending: true });
      const subject = (classRow.subjects as unknown as Array<{ name?: string }> | { name?: string } | null);
      const subjectName = (Array.isArray(subject) ? subject[0] : subject)?.name;
      const source = (materials ?? []).map((material) => `### ${material.title}${material.chapter ? ` (${material.chapter})` : ''}\n${material.extracted_text ?? ''}`).join('\n\n');
      const group = classRow.class_groups as unknown as Array<{ name?: string }> | { name?: string } | null;
      const groupName = (Array.isArray(group) ? group[0] : group)?.name;
      lessonContext = `Class: ${groupName ?? 'School course'} — ${classRow.name}\nSubject: ${subjectName ?? 'school subject'}\nApproved teacher materials:\n${source || 'No extracted materials are available yet.'}`;
    }
  }

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
    method: 'POST',
    headers: { 'x-goog-api-key': geminiApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
      bidiGenerateContentSetup: {
        model: `models/${liveModel}`,
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } },
        systemInstruction: { parts: [{ text: `You are School Buddy, the friendly live voice tutor inside the School Buddy learning platform. Speak in ${language} using a ${voiceStyle} style. If a previous lesson transcript is supplied, continue naturally from it and do not repeat the greeting. If this is linked to an assignment, begin by acknowledging the previous progress and explicitly tell the student: "Let's focus on these questions now so you can understand them and answer confidently." Then guide them through the assignment questions one at a time. Help students understand their lessons with short, age-appropriate, step-by-step answers. Use the approved course context below as your primary source. Do not invent teacher policies, grades, or private information. If the answer is not in the supplied context, say so clearly and provide only general educational guidance. Redirect unrelated requests back to the lesson. This is a learning session, not general chat: every few exchanges, ask one short understanding-check question about the lesson. Wait for the student's answer, encourage their reasoning, and gently correct misconceptions. Do not turn the session into a formal exam unless the student asks. Never submit an assignment without the student's explicit confirmation.\n\n${lessonContext}${learningContext}${previousTranscript ? `\n\nPrevious lesson transcript:\n${previousTranscript}` : ''}` }] },
      },
    }),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== 'object' || !('name' in data) || typeof data.name !== 'string') {
    const providerMessage = data && typeof data === 'object' && 'error' in data && data.error && typeof data.error === 'object' && 'message' in data.error && typeof data.error.message === 'string' ? data.error.message : 'Gemini rejected the Live session token request.';
    return NextResponse.json({ error: providerMessage }, { status: 502 });
  }
  return NextResponse.json({ token: data.name });
}
