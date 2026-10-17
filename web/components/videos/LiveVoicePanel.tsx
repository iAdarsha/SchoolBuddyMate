'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

function decodeBase64(value: string) {
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  return bytes;
}

function encodePcm(input: Float32Array, inputSampleRate: number) {
  const ratio = inputSampleRate / 16000;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Int16Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = Math.min(input.length - 1, Math.round(index * ratio));
    output[index] = Math.max(-1, Math.min(1, input[sourceIndex])) * 0x7fff;
  }
  const bytes = new Uint8Array(output.buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function buildLearningEvaluation(transcript: Array<{ speaker: string; text: string }>) {
  const questions = transcript.filter((item) => item.speaker === 'School Buddy' && /\?|explain|why|how|what do you think|try/i.test(item.text));
  const answers = transcript.filter((item) => item.speaker === 'You');
  const correctSignals = answers.filter((item) => /yes|correct|because|means|is when|works by|first|second|example/i.test(item.text)).length;
  const understandingScore = answers.length ? Math.min(100, Math.round((correctSignals / answers.length) * 70 + Math.min(30, answers.length * 6))) : 0;
  return {
    understanding_score: understandingScore,
    questions_asked: questions.length,
    answers_given: answers.length,
    correct_signals: correctSignals,
    needs_revision: answers.length > 0 && understandingScore < 60,
    topic: 'Lesson understanding check',
    strengths: correctSignals > 0 ? ['Participated in understanding checks'] : [],
    recommended_actions: understandingScore < 60 ? ['Review the lesson concepts', 'Complete a short revision quiz'] : ['Try an application question', 'Continue to the next lesson section'],
    evidence: { questions: questions.slice(-8), answers: answers.slice(-8) },
  };
}

export default function LiveVoicePanel({ classes = [], userId, autoStart = false, initialClassId, assignmentId }: { classes?: Array<{ id: string; label: string }>; userId?: string; autoStart?: boolean; initialClassId?: string; assignmentId?: string }) {
  const router = useRouter();
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const nextAudioTimeRef = useRef(0);
  const outputSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Hi! I’m School Buddy. Ask me anything about this lesson.');
  const [transcript, setTranscript] = useState<Array<{ speaker: string; text: string }>>([]);
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  const [micLevel, setMicLevel] = useState(0);
  const [voiceDetected, setVoiceDetected] = useState(false);
  const [classId, setClassId] = useState('');
  const [voiceName, setVoiceName] = useState('Kore');
  const [language, setLanguage] = useState('English');
  const [voiceStyle, setVoiceStyle] = useState('Friendly tutor');
  const [restoredSessionId, setRestoredSessionId] = useState<string | null>(null);
  type SavedSession = { id: string; classId: string | null; assignmentId: string | null; transcript: Array<{ speaker: string; text: string }>; summary: string | null; updatedAt: string; voiceName: string; language: string; voiceStyle: string };
  const [previousSession, setPreviousSession] = useState<SavedSession | null>(null);
  const [sessionHistory, setSessionHistory] = useState<SavedSession[]>([]);
  const [sessionSaveStatus, setSessionSaveStatus] = useState('');
  const [paused, setPaused] = useState(false);
  const voiceDetectedTimerRef = useRef<number | null>(null);
  const speakingTimerRef = useRef<number | null>(null);
  const inactivityTimerRef = useRef<number | null>(null);
  const speechFramesRef = useRef(0);
  const autoPausedRef = useRef(false);
  const autoStartedRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    if (!supabase) return;
    void supabase.from('live_voice_sessions').select('id, class_id, assignment_id, transcript, summary, updated_at, voice_name, language, voice_style').eq('user_id', userId).order('updated_at', { ascending: false }).limit(20).then(({ data, error }) => {
      if (error) { console.error('Could not restore School Buddy session:', error); return; }
      const sessions = (data ?? []).filter((item) => Array.isArray(item.transcript) && item.transcript.length > 0).map((item) => ({ id: item.id, classId: typeof item.class_id === 'string' ? item.class_id : null, assignmentId: typeof item.assignment_id === 'string' ? item.assignment_id : null, transcript: item.transcript as Array<{ speaker: string; text: string }>, summary: typeof item.summary === 'string' ? item.summary : null, updatedAt: item.updated_at, voiceName: typeof item.voice_name === 'string' ? item.voice_name : 'Kore', language: typeof item.language === 'string' ? item.language : 'English', voiceStyle: typeof item.voice_style === 'string' ? item.voice_style : 'Friendly tutor' }));
      setSessionHistory(sessions);
      if (sessions[0]) setPreviousSession(sessions[0]);
      if (autoStart && !autoStartedRef.current) {
        autoStartedRef.current = true;
        const matching = sessions.find((session) => assignmentId && session.assignmentId === assignmentId) ?? sessions.find((session) => session.classId === initialClassId) ?? sessions[0];
        if (matching) {
          setRestoredSessionId(matching.id); setClassId(initialClassId || matching.classId || classes[0]?.id || ''); setTranscript(matching.transcript); setVoiceName(matching.voiceName); setLanguage(matching.language); setVoiceStyle(matching.voiceStyle);
          setPreviousSession(null);
          void start({ classId: initialClassId || matching.classId || classes[0]?.id || '', voiceName: matching.voiceName, language: matching.language, voiceStyle: matching.voiceStyle, transcript: matching.transcript });
        } else if (initialClassId || classes[0]?.id) {
          setClassId(initialClassId || classes[0]?.id || '');
          void start({ classId: initialClassId || classes[0]?.id || '', voiceName, language, voiceStyle, transcript: [] });
        }
      }
    });
  }, [userId]);

  const continuePreviousSession = () => {
    if (!previousSession) return;
    setRestoredSessionId(previousSession.id);
    setClassId(previousSession.classId || classes[0]?.id || '');
    setTranscript(previousSession.transcript);
    setVoiceName(previousSession.voiceName);
    setLanguage(previousSession.language);
    setVoiceStyle(previousSession.voiceStyle);
    setPreviousSession(null);
    void start({ classId: previousSession.classId || classes[0]?.id || '', voiceName: previousSession.voiceName, language: previousSession.language, voiceStyle: previousSession.voiceStyle, transcript: previousSession.transcript });
  };

  const choosePreviousSession = (session: SavedSession) => setPreviousSession(session);

  const startNewSession = () => {
    setPreviousSession(null);
    setRestoredSessionId(null);
    setTranscript([]);
    setMessage('Hi! I’m School Buddy. Ask me anything about this lesson.');
  };

  const deleteSession = async (session: SavedSession) => {
    if (!window.confirm('Do you want to delete this conversation permanently?')) return;
    const supabase = createClient();
    if (!supabase) return;
    const { error } = await supabase.from('live_voice_sessions').delete().eq('id', session.id);
    if (error) { setSessionSaveStatus(`Could not delete session: ${error.message}`); return; }
    setSessionHistory((items) => items.filter((item) => item.id !== session.id));
    if (previousSession?.id === session.id) { setPreviousSession(null); setTranscript([]); }
    setSessionSaveStatus('Conversation deleted.');
  };

  const deleteSelectedSession = async () => { if (previousSession) await deleteSession(previousSession); };

  const interruptResponse = () => {
    for (const source of outputSourcesRef.current) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    outputSourcesRef.current.clear();
    nextAudioTimeRef.current = 0;
    speakingRef.current = false;
    setSpeaking(false);
  };

  useEffect(() => () => { if (speakingTimerRef.current) window.clearTimeout(speakingTimerRef.current); if (voiceDetectedTimerRef.current) window.clearTimeout(voiceDetectedTimerRef.current); if (inactivityTimerRef.current) window.clearTimeout(inactivityTimerRef.current); stop(); }, []);

  const playAudio = (base64: string) => {
    speakingRef.current = true;
    setSpeaking(true);
    if (speakingTimerRef.current) window.clearTimeout(speakingTimerRef.current);
    speakingTimerRef.current = window.setTimeout(() => {
      if (outputSourcesRef.current.size === 0) { speakingRef.current = false; setSpeaking(false); if (socketRef.current) setMessage('School Buddy is listening… ask your lesson question.'); }
    }, 1200);
    const context = outputContextRef.current ?? new AudioContext({ sampleRate: 24000 });
    outputContextRef.current = context;
    void context.resume();
    const bytes = decodeBase64(base64);
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const buffer = context.createBuffer(1, samples.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) channel[index] = samples[index] / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    outputSourcesRef.current.add(source);
    source.onended = () => {
      outputSourcesRef.current.delete(source);
      if (outputSourcesRef.current.size === 0) { speakingRef.current = false; setSpeaking(false); if (socketRef.current) setMessage('School Buddy is listening… ask your lesson question.'); }
    };
    nextAudioTimeRef.current = Math.max(nextAudioTimeRef.current, context.currentTime);
    source.start(nextAudioTimeRef.current);
    nextAudioTimeRef.current += buffer.duration;
  };

  async function start(options?: { classId?: string; voiceName?: string; language?: string; voiceStyle?: string; transcript?: Array<{ speaker: string; text: string }> }) {
    const selectedClassId = options?.classId ?? classId;
    const selectedVoiceName = options?.voiceName ?? voiceName;
    const selectedLanguage = options?.language ?? language;
    const selectedVoiceStyle = options?.voiceStyle ?? voiceStyle;
    const selectedTranscript = options?.transcript ?? transcript;
    setBusy(true);
    setMessage('Connecting to School Buddy Live Session…');
    const tokenResponse = await fetch('/api/gemini/live-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classId: selectedClassId, assignmentId, voiceName: selectedVoiceName, language: selectedLanguage, voiceStyle: selectedVoiceStyle, previousTranscript: selectedTranscript.slice(-12) }) });
    const tokenData = await tokenResponse.json().catch(() => null);
    if (!tokenResponse.ok || !tokenData?.token) { setMessage(tokenData?.error ?? 'Could not start the School Buddy Live Session.'); setBusy(false); return; }
    const socket = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(tokenData.token)}`);
    socketRef.current = socket;
    let microphoneStarted = false;
    let greetingSent = false;
    const beginMicrophone = async () => {
      if (microphoneStarted) return;
      microphoneStarted = true;
      if (!navigator.mediaDevices?.getUserMedia) {
        setMessage('Microphone access is unavailable. Use localhost or HTTPS in a supported browser.');
        setBusy(false);
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        const name = error instanceof DOMException ? error.name : '';
        setMessage(name === 'NotAllowedError' ? 'Microphone permission was blocked. Allow microphone access in your browser, then start again.' : 'No microphone was found or it is already unavailable. Check your device settings.');
        setBusy(false);
        return;
      }
      streamRef.current = stream;
      const context = new AudioContext({ sampleRate: 16000 });
      inputContextRef.current = context;
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (event) => {
        const samples = event.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index];
        setMicLevel(Math.min(1, Math.sqrt(sum / samples.length) * 8));
        const rms = Math.sqrt(sum / samples.length);
        const speechLike = rms > 0.045;
        if (speechLike) speechFramesRef.current += 1;
        else speechFramesRef.current = 0;
        if (speechLike) {
          if (inactivityTimerRef.current) window.clearTimeout(inactivityTimerRef.current);
          inactivityTimerRef.current = window.setTimeout(() => { autoPausedRef.current = true; setPaused(true); setMessage('Paused after 10 seconds of silence. Speak whenever you are ready.'); setSessionSaveStatus('Paused after 10 seconds of silence — speak to resume.'); }, 10000);
          if (autoPausedRef.current) { autoPausedRef.current = false; setPaused(false); setSessionSaveStatus(''); setMessage('School Buddy is listening…'); }
          setVoiceDetected(true);
          if (voiceDetectedTimerRef.current) window.clearTimeout(voiceDetectedTimerRef.current);
          voiceDetectedTimerRef.current = window.setTimeout(() => setVoiceDetected(false), 900);
        }
        // `speaking` from React state would be stale inside this long-lived
        // microphone callback. Use the ref so the first real speech frame
        // reliably cuts off every queued Gemini audio buffer.
        if (speechFramesRef.current === 3 && speakingRef.current) interruptResponse();
        if (!autoPausedRef.current && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ realtimeInput: { audio: { data: encodePcm(samples, context.sampleRate), mimeType: 'audio/pcm;rate=16000' } } }));
      };
      source.connect(processor);
      processor.connect(context.destination);
      inactivityTimerRef.current = window.setTimeout(() => { autoPausedRef.current = true; setPaused(true); setMessage('Paused after 10 seconds of silence. Speak whenever you are ready.'); setSessionSaveStatus('Paused after 10 seconds of silence — speak to resume.'); }, 10000);
      setConnected(true);
      setBusy(false);
      setMessage('Listening… ask a question about your lesson.');
    };
    socket.onopen = async () => {
      socket.send(JSON.stringify({ setup: { model: 'models/gemini-3.8-live', generationConfig: { responseModalities: ['AUDIO'] }, inputAudioTranscription: {}, outputAudioTranscription: {} } }));
      setMessage('Connected. Preparing microphone…');
      window.setTimeout(() => { if (!streamRef.current) void beginMicrophone(); }, 1200);
    };
    socket.onmessage = async (event) => {
      const raw = event.data instanceof Blob
        ? await event.data.text()
        : event.data instanceof ArrayBuffer
          ? new TextDecoder().decode(event.data)
          : String(event.data);
      let response: { error?: { message?: string }; setupComplete?: unknown; serverContent?: { modelTurn?: { parts?: Array<{ inlineData?: { data?: string }; text?: string }> }; inputTranscription?: { text?: string }; outputTranscription?: { text?: string } } };
      try {
        response = JSON.parse(raw);
      } catch {
        setMessage('Gemini sent an unreadable Live API message.');
        return;
      }
      if (socketRef.current !== socket) return;
      if (response.error) { setMessage(response.error.message ?? 'Gemini rejected the audio session.'); return; }
      if (response.setupComplete) {
        setMessage('School Buddy is listening… ask your lesson question.');
        if (!greetingSent) {
          greetingSent = true;
          const resumeHint = selectedTranscript.slice(-6).map((item) => `${item.speaker}: ${item.text}`).join(' ').slice(0, 1200);
          const opening = assignmentId
            ? `Resume the previous lesson conversation if one exists. This is a follow-up study session for a specific assignment. Welcome the student to School Buddy, briefly acknowledge where they left off, then clearly say: "Let’s focus on these questions now so you can understand them and answer confidently." Ask the student to begin with the first question or concept they found difficult. Assignment-linked context is already available to you. ${resumeHint}`
            : selectedTranscript.length
              ? `Resume the previous lesson. Mention the recent topic briefly and ask if the student would like to continue: ${resumeHint}`
              : 'Greet the student warmly in one short sentence: welcome them to School Buddy and invite them to ask a lesson question.';
          socket.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: opening }] }], turnComplete: true } }));
        }
        if (!streamRef.current) void beginMicrophone();
      }
      const content = response.serverContent;
      if (content?.inputTranscription?.text) setTranscript((items) => [...items, { speaker: 'You', text: content.inputTranscription!.text! }]);
      if (content?.outputTranscription?.text) setTranscript((items) => [...items, { speaker: 'School Buddy', text: content.outputTranscription!.text! }]);
      for (const part of content?.modelTurn?.parts ?? []) if (part.inlineData?.data) { setMessage('School Buddy is speaking…'); playAudio(part.inlineData.data); }
    };
    socket.onerror = () => { setMessage('School Buddy Live Session connection failed. Please try again.'); stop(); };
    socket.onclose = (event) => {
      setConnected(false);
      setBusy(false);
      if (event.code !== 1000) setMessage(`School Buddy Live Session closed (${event.code}${event.reason ? `: ${event.reason}` : ''}).`);
    };
  }

  function stop() {
    if (userId && transcript.length > 0) {
      const supabase = createClient();
      if (supabase) {
        setSessionSaveStatus('Saving this lesson…');
        const fallbackEvaluation = buildLearningEvaluation(transcript);
        void supabase.from('live_voice_sessions').upsert({ ...(restoredSessionId ? { id: restoredSessionId } : {}), user_id: userId, class_id: classId || null, assignment_id: assignmentId || null, voice_name: voiceName, language, voice_style: voiceStyle, transcript, summary: fallbackEvaluation.topic, updated_at: new Date().toISOString() }).select('id').single().then(async ({ data: savedSession, error }) => {
          if (!error && savedSession?.id) {
            const evaluationResponse = await fetch('/api/gemini/live-evaluation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classId: classId || undefined, transcript }) });
            const evaluationPayload = await evaluationResponse.json().catch(() => null) as { evaluation?: Record<string, unknown> } | null;
            const evaluation = evaluationPayload?.evaluation ?? fallbackEvaluation;
            await supabase.from('live_learning_evaluations').upsert({ session_id: savedSession.id, student_id: userId, class_id: classId || null, understanding_score: Number(evaluation.understanding_score ?? 0), questions_asked: Number(evaluation.questions_asked ?? 0), answers_given: Number(evaluation.answers_given ?? 0), correct_signals: Number(evaluation.correct_signals ?? 0), needs_revision: Boolean(evaluation.needs_revision), topic: typeof evaluation.topic === 'string' ? evaluation.topic : fallbackEvaluation.topic, strengths: Array.isArray(evaluation.strengths) ? evaluation.strengths : [], recommended_actions: Array.isArray(evaluation.recommended_actions) ? evaluation.recommended_actions : [], evidence: evaluation, updated_at: new Date().toISOString() }, { onConflict: 'session_id' });
            const saved = { id: savedSession.id, classId: classId || null, assignmentId: assignmentId || null, transcript, summary: typeof evaluation.topic === 'string' ? evaluation.topic : fallbackEvaluation.topic, updatedAt: new Date().toISOString(), voiceName, language, voiceStyle };
            setSessionHistory((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
            setSessionSaveStatus('Progress saved. Your lesson is ready to continue later.');
            router.refresh();
          } else {
            setSessionSaveStatus(`Could not save lesson: ${error?.message ?? 'The saved session was not returned.'}`);
          }
        });
      }
    } else if (userId) {
      setSessionSaveStatus('No conversation to save yet. Ask a question first.');
    }
    interruptResponse();
    processorRef.current?.disconnect();
    inputContextRef.current?.close();
    outputContextRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    socketRef.current?.close();
    processorRef.current = null;
    inputContextRef.current = null;
    outputContextRef.current = null;
    streamRef.current = null;
    socketRef.current = null;
    setConnected(false);
    setMicLevel(0);
    setVoiceDetected(false);
    autoPausedRef.current = false;
    setPaused(false);
    speechFramesRef.current = 0;
    setBusy(false);
    setMessage('Hi! I’m School Buddy. Ask me anything about this lesson.');
  }

  function togglePause() {
    if (autoPausedRef.current) {
      autoPausedRef.current = false;
      setPaused(false);
      setSessionSaveStatus('');
      setMessage('School Buddy is listening…');
      inactivityTimerRef.current = window.setTimeout(() => { autoPausedRef.current = true; setMessage('Paused after 10 seconds of silence. Speak whenever you are ready.'); setSessionSaveStatus('Paused after 10 seconds of silence — speak to resume.'); }, 10000);
    } else {
      autoPausedRef.current = true;
      setPaused(true);
      if (inactivityTimerRef.current) window.clearTimeout(inactivityTimerRef.current);
      setMessage('Session paused. Click resume or speak to continue.');
      setSessionSaveStatus('Session paused — microphone input is temporarily off.');
    }
  }

  return <section className="live-voice-layout mx-auto w-full max-w-7xl flex-1 px-6 py-10">
    {previousSession && <div className="mb-5 rounded-2xl border border-primary/20 bg-card p-5 shadow-lg" role="dialog" aria-labelledby="continue-lesson-title"><div className="flex flex-wrap items-start justify-between gap-5"><div className="min-w-0 max-w-2xl"><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Welcome back</p><h2 id="continue-lesson-title" className="mt-1 text-xl font-bold text-foreground">Ready to pick up where you left off?</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Your last School Buddy session is saved. Continue the same lesson with your previous settings and conversation.</p><p className="mt-2 text-xs text-muted-foreground">Saved {new Date(previousSession.updatedAt).toLocaleString()}</p></div><div className="flex shrink-0 flex-wrap gap-2"><button onClick={continuePreviousSession} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Continue conversation</button><button onClick={startNewSession} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground">Start new</button></div></div></div>}
    {sessionHistory.length > 0 && <div className="live-session-history mb-6 rounded-2xl border border-border bg-card p-4"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Your history</p><h2 className="mt-1 text-lg font-bold text-foreground">Previous sessions</h2></div><span className="text-xs text-muted-foreground">{sessionHistory.length} saved</span></div><div className="mt-3 space-y-2">{sessionHistory.map((session) => <div key={session.id} className={`flex items-center gap-3 rounded-xl border p-3 ${previousSession?.id === session.id ? 'border-primary bg-primary/5' : 'border-border'}`}><button onClick={() => choosePreviousSession(session)} className="min-w-0 flex-1 text-left"><p className="text-xs font-semibold text-muted-foreground">{new Date(session.updatedAt).toLocaleDateString()}</p><p className="mt-1 truncate text-sm font-semibold text-foreground">Topic: {session.summary || classes.find((item) => item.id === session.classId)?.label || 'School lesson'}</p><p className="mt-1 text-xs text-primary">{classes.find((item) => item.id === session.classId)?.label || 'School lesson'}</p></button><button onClick={() => void deleteSession(session)} title="Delete conversation" aria-label={`Delete conversation from ${new Date(session.updatedAt).toLocaleDateString()}`} className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-danger hover:bg-danger/10">Delete</button></div>)}</div></div>}
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">School Buddy Live Session</p><h1 className="mt-1 text-3xl font-bold text-foreground">Talk through a lesson</h1><p className="mt-2 text-sm text-muted-foreground">Ask questions aloud and receive spoken explanations in real time.</p></div>
        {!connected ? <button onClick={() => void start()} disabled={busy || !classId} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? 'Connecting…' : 'Start live voice'}</button> : <div className="flex items-center gap-2"><button onClick={togglePause} title={paused ? 'Resume microphone' : 'Pause microphone'} aria-label={paused ? 'Resume microphone' : 'Pause microphone'} className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border text-base font-bold transition ${paused ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-card text-foreground hover:bg-background'}`}><span aria-hidden="true">{paused ? '▶' : '⏸'}</span></button><button onClick={stop} className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white">End session</button></div>}
      </div>
      <div className={`mt-6 rounded-2xl p-8 text-center ${connected ? 'bg-[#090d16]' : 'bg-background'}`}><div className="relative mx-auto h-56 w-72"><div className="absolute left-1/2 top-1/2 h-52 w-52 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/20 transition-transform duration-100" style={{ transform: `translate(-50%, -50%) scale(${1 + micLevel * 0.22})`, opacity: 0.35 + micLevel * 0.5 }} /><div className={`absolute left-10 top-4 h-44 w-44 overflow-hidden rounded-full bg-gradient-to-br from-[#667cff] via-[#b9c6ff] to-[#dbe3ff] shadow-[0_0_65px_rgba(99,117,255,0.55)] ${speaking || micLevel > 0.08 ? 'animate-[cloud-breathe_1.1s_ease-in-out_infinite]' : 'animate-[cloud-breathe_4s_ease-in-out_infinite]'}`}><div className="absolute -left-8 top-8 h-24 w-32 rounded-full bg-white/75 blur-xl animate-[cloud-drift_4s_ease-in-out_infinite]" /><div className="absolute -right-10 top-20 h-28 w-36 rounded-full bg-[#8195ff]/80 blur-xl animate-[cloud-drift_5s_ease-in-out_infinite_reverse]" /><div className="absolute -bottom-8 left-8 h-24 w-32 rounded-full bg-white/70 blur-2xl" /><div className={`absolute inset-0 rounded-full ring-1 ring-white/80 ${speaking || micLevel > 0.08 ? 'animate-pulse' : ''}`} /></div><span className="absolute left-0 top-8 animate-[school-float_3s_ease-in-out_infinite] text-2xl" title="School Buddy">🎓</span><span className="absolute right-0 top-28 animate-[school-float_4s_ease-in-out_infinite_reverse] text-xl" title="Learning buddy">📘</span><span className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-primary/80">School Buddy</span></div><p className={`mt-1 text-sm font-semibold ${connected ? 'text-white/80' : 'text-foreground'}`}>{speaking ? 'Gemini is speaking…' : connected ? 'Listening…' : message}</p>{connected && <p className={`mt-2 text-xs ${voiceDetected ? 'text-primary' : 'text-white/45'}`}>{voiceDetected ? 'Voice detected' : 'Speak whenever you are ready'}</p>}<div className={`live-speaker-status mx-auto mt-3 inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-bold ${speaking ? 'border-primary/30 bg-primary/10 text-primary' : voiceDetected ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : connected ? 'border-white/20 bg-white/10 text-white/80' : 'border-border bg-card text-muted-foreground'}`} aria-live="polite"><span className={`h-2.5 w-2.5 rounded-full ${speaking ? 'animate-pulse bg-primary' : voiceDetected ? 'animate-pulse bg-emerald-500' : connected ? 'bg-white/70' : 'bg-slate-300'}`} />{speaking ? 'School Buddy is responding' : voiceDetected ? 'You are speaking' : connected ? 'School Buddy is listening' : 'Ready for a lesson'}</div></div>
      <div className="mt-6 space-y-3"><h2 className="text-sm font-bold text-foreground">Conversation</h2>{transcript.length ? transcript.map((item, index) => <p key={`${item.speaker}-${index}`} className="rounded-lg bg-background p-3 text-sm"><span className="font-bold text-primary">{item.speaker}: </span>{item.text}</p>) : <p className="text-sm text-muted-foreground">Your conversation transcript will appear here.</p>}</div>
      <footer className="mt-5 grid gap-4 rounded-2xl border border-primary/15 bg-primary/[0.04] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <label className="block text-left text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Lesson focus
          <select value={classId} onChange={(event) => setClassId(event.target.value)} disabled={connected || busy} className="mt-2 block w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold normal-case tracking-normal text-foreground outline-none focus:border-primary disabled:opacity-60">
            <option value="">Please select a lesson to begin</option>
            {classes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <span className="mt-2 block text-xs font-normal normal-case tracking-normal text-muted-foreground">Choose your lesson first. Voice, language, and speaking style are optional and can be changed anytime before starting.</span>
        </label>
        <div className="grid gap-3 sm:grid-cols-3 sm:col-span-2">
          <label className="text-left text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Voice
            <select value={voiceName} onChange={(event) => setVoiceName(event.target.value)} disabled={connected || busy} className="mt-2 block w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold normal-case tracking-normal text-foreground outline-none focus:border-primary disabled:opacity-60"><option value="Kore">Kore · Warm</option><option value="Aoede">Aoede · Bright</option><option value="Puck">Puck · Friendly</option><option value="Charon">Charon · Clear</option><option value="Leda">Leda · Calm</option><option value="Zephyr">Zephyr · Gentle</option></select>
          </label>
          <label className="text-left text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Language
            <select value={language} onChange={(event) => setLanguage(event.target.value)} disabled={connected || busy} className="mt-2 block w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold normal-case tracking-normal text-foreground outline-none focus:border-primary disabled:opacity-60"><option>English</option><option>Hindi</option><option>Tamil</option><option>Kannada</option><option>Nepali</option><option>Spanish</option></select>
          </label>
          <label className="text-left text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Speaking style
            <select value={voiceStyle} onChange={(event) => setVoiceStyle(event.target.value)} disabled={connected || busy} className="mt-2 block w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold normal-case tracking-normal text-foreground outline-none focus:border-primary disabled:opacity-60"><option>Friendly tutor</option><option>Calm explainer</option><option>Energetic coach</option><option>Short exam revision</option></select>
          </label>
        </div>
        {sessionSaveStatus && <p className={`text-xs sm:col-span-2 ${sessionSaveStatus.startsWith('Session paused') || sessionSaveStatus.startsWith('Paused after') ? 'live-paused-message' : ''} ${sessionSaveStatus.startsWith('Could not') ? 'text-danger' : 'text-muted-foreground'}`} role="status">{sessionSaveStatus}</p>}
      </footer>
    </div>
  </section>;
}
