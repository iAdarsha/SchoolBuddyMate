'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import ChatSources from '@/components/ChatSources';
import type { ChatGrounding } from '@shared/domain/chat';
import { getVideoEmbedUrl } from '@shared/domain/learning';
import type { Role } from '@shared/domain/profile';
import { BookIcon, CheckIcon, CopyIcon, FileTextIcon, HistoryIcon, MicIcon, PaperclipIcon, PlusIcon, RefreshIcon, SendIcon, SparkleIcon, SpeakerIcon, SpeakerOffIcon, ThumbDownIcon, ThumbUpIcon, TrashIcon, XIcon } from '@/components/icons';
import { useLanguage } from '@/components/LanguageProvider';
import { takeChatHandoff } from '@/lib/chatHandoff';
import { stripMarkdownForSpeech } from '@/lib/markdown';
import { createClient } from '@/lib/supabase/client';

const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-1.5 last:mb-0">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="mb-1.5 list-disc space-y-0.5 pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="mb-1.5 list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold">{children}</strong>,
  h1: ({ children }: { children?: React.ReactNode }) => <p className="mb-1 font-semibold">{children}</p>,
  h2: ({ children }: { children?: React.ReactNode }) => <p className="mb-1 font-semibold">{children}</p>,
  h3: ({ children }: { children?: React.ReactNode }) => <p className="mb-1 font-semibold">{children}</p>,
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline">
      {children}
    </a>
  ),
  code: ({ children }: { children?: React.ReactNode }) => <code className="rounded bg-secondary px-1 py-0.5 text-xs">{children}</code>,
  hr: () => null,
};

interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  text: string;
  grounding?: ChatGrounding | null;
  feedback?: 1 | -1 | null;
  feedback_reason?: FeedbackReason | null;
  // Display-only — never persisted on the user's own row. Set immediately
  // from the File objects at send time, or reconstructed on load from the
  // following assistant message's grounding.sources (kind: 'attachment'),
  // since the raw file itself is never stored (see web/README.md's AI Chat
  // section) — only Gemini's extracted description survives, as a source.
  attachmentNames?: string[];
}

type FeedbackReason = 'incorrect' | 'missing_sources' | 'not_helpful' | 'unsafe';
const FEEDBACK_REASONS: Array<{ value: FeedbackReason; label: string }> = [
  { value: 'incorrect', label: 'Incorrect' },
  { value: 'missing_sources', label: 'Missing sources' },
  { value: 'not_helpful', label: 'Not helpful' },
  { value: 'unsafe', label: 'Unsafe or inappropriate' },
];

interface ChatSession {
  id: string;
  title: string;
  updated_at: string;
  class_id?: string | null;
  chapter?: string | null;
}

interface SubjectOption {
  id: string;
  label: string;
}

interface GuidedMaterial {
  id: string;
  title: string;
  chapter: string | null;
  video_url: string | null;
}

const SPEECH_LANG: Record<string, string> = { en: 'en-US', hi: 'hi-IN', te: 'te-IN' };
const CHAT_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'];
const NEW_CHAT_MARKER = 'new';
const MAX_AUTO_SEND_TRANSCRIPT_WORDS = 18;

function cleanVoiceTranscript(value: string) {
  const words = value.replace(/\s+/g, ' ').trim().split(' ');
  while (words.length > 1) {
    const last = words[words.length - 1].replace(/[^A-Za-z]/g, '');
    if (last.length >= 4 && !/[aeiou]/i.test(last)) words.pop();
    else break;
  }
  return words.join(' ').replace(/\s+([?.!,])/g, '$1').trim();
}

// The raw file is never stored (only Gemini's extracted description
// survives, as a grounding source on the ASSISTANT's reply) — so on load,
// reattach each user turn's attachment filenames from the very next
// message's grounding.sources, the only place they're actually persisted.
function withAttachmentNames(history: ChatMessage[]): ChatMessage[] {
  return history.map((message, index) => {
    if (message.role !== 'user') return message;
    const reply = history[index + 1];
    if (!reply || reply.role !== 'assistant') return message;
    const names = (reply.grounding?.sources ?? []).filter((source) => source.kind === 'attachment').map((source) => source.label);
    return names.length ? { ...message, attachmentNames: names } : message;
  });
}

interface SpeechRecognitionAlternativeLike { transcript: string; confidence?: number }
interface SpeechRecognitionResultLike { isFinal: boolean; 0: SpeechRecognitionAlternativeLike }
interface SpeechRecognitionEventLike { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> }
interface SpeechRecognitionLike {
  continuous: boolean; interimResults: boolean; lang: string;
  start(): void; stop(): void; abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export default function AiChat({ role, userId }: { role: Role; userId: string }) {
  const { t, language } = useLanguage();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [dictationListening, setDictationListening] = useState(false);
  const [conversationListening, setConversationListening] = useState(false);
  const [recordingFallback, setRecordingFallback] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [conversationActive, setConversationActive] = useState(false);
  const [conversationStatus, setConversationStatus] = useState<'listening' | 'thinking' | 'speaking'>('listening');
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [guidedClassId, setGuidedClassId] = useState<string | null>(null);
  const [guidedChapter, setGuidedChapter] = useState<string | null>(null);
  const [guidedLabel, setGuidedLabel] = useState('');
  const [pickerStage, setPickerStage] = useState<'closed' | 'subject' | 'chapter'>('closed');
  const [subjectOptions, setSubjectOptions] = useState<SubjectOption[]>([]);
  const [chapterOptions, setChapterOptions] = useState<string[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [guidedMaterials, setGuidedMaterials] = useState<GuidedMaterial[]>([]);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [materialFiles, setMaterialFiles] = useState<{ path: string; mime: string; url: string }[]>([]);
  const [materialFilesLoading, setMaterialFilesLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceBaseRef = useRef('');
  const speechFailedRef = useRef(false);
  const dictationFinalTranscriptRef = useRef('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingHeardSpeechRef = useRef(false);
  const recordingPeakVolumeRef = useRef(0);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const voiceDetectionTimerRef = useRef<number | null>(null);
  const voiceAudioContextRef = useRef<AudioContext | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const conversationRef = useRef(false);
  const conversationTranscriptRef = useRef('');
  const activeChatStorageKey = `schoolbuddy-active-chat:${userId}`;

  const closeVoiceAudioContext = useCallback(() => {
    const context = voiceAudioContextRef.current;
    voiceAudioContextRef.current = null;
    if (!context || context.state === 'closed') return;
    void context.close().catch(() => {
      // Some browsers close this automatically when the microphone stream ends.
    });
  }, []);

  const stopRecorder = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') recorder.stop();
    recorderRef.current = null;
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    if (voiceDetectionTimerRef.current) window.clearInterval(voiceDetectionTimerRef.current);
    voiceDetectionTimerRef.current = null;
    closeVoiceAudioContext();
  }, [closeVoiceAudioContext]);

  const suggestedPrompts = role === 'admin' || role === 'vice_principal'
    ? [t('chat.schoolPromptTeachers'), t('chat.schoolPromptSubjects'), t('chat.schoolPromptAssignments'), t('chat.schoolPromptMaterials')]
    : [t('chat.schoolPromptClasses'), t('chat.schoolPromptAssignments'), t('chat.prompt1'), t('chat.prompt2')];
  const reviewVoiceBeforeSend = role === 'admin' || role === 'vice_principal';
  const useRecorderFirst = reviewVoiceBeforeSend;
  // A student must anchor every new conversation to a subject (and
  // optionally a chapter) before they can type — history/past sessions
  // remain fully usable regardless, since they already have (or
  // deliberately lack) that context.
  const chatLocked = role === 'student' && !guidedClassId && !activeSessionId;

  const loadSessions = async () => {
    const supabase = createClient();
    if (!supabase) return;
    const { data } = await supabase.from('ai_chat_sessions').select('id, title, updated_at, class_id, chapter').order('updated_at', { ascending: false });
    setSessions(data ?? []);
  };

  const loadGuidedMaterials = async (classId: string, chapter: string | null) => {
    const supabase = createClient();
    if (!supabase) return;
    let query = supabase.from('materials').select('id, title, chapter, video_url').eq('class_id', classId).eq('status', 'extracted');
    if (chapter) query = query.eq('chapter', chapter);
    const { data } = await query.order('created_at', { ascending: false });
    setGuidedMaterials(data ?? []);
    setSelectedMaterialId(null);
    setMaterialFiles([]);
  };

  const loadGuidedLabel = async (classId: string) => {
    const supabase = createClient();
    if (!supabase) return;
    const { data } = await supabase.from('classes').select('name, subjects(name)').eq('id', classId).single();
    const row = data as unknown as { name: string; subjects: { name: string } | null } | null;
    setGuidedLabel(row?.subjects?.name ?? row?.name ?? '');
  };

  const selectGuidedMaterial = async (material: GuidedMaterial) => {
    setSelectedMaterialId(material.id);
    setMaterialFilesLoading(true);
    setMaterialFiles([]);
    const supabase = createClient();
    if (!supabase) { setMaterialFilesLoading(false); return; }
    const { data: files } = await supabase.from('material_files').select('file_path, mime_type').eq('material_id', material.id).order('position');
    const signed = await Promise.all((files ?? []).map(async (file) => {
      const { data: signedData } = await supabase.storage.from('materials').createSignedUrl(file.file_path, 3600);
      return { path: file.file_path, mime: file.mime_type, url: signedData?.signedUrl ?? '' };
    }));
    setMaterialFiles(signed.filter((file) => file.url));
    setMaterialFilesLoading(false);
  };

  const openPicker = async () => {
    setPickerStage('subject');
    setPickerLoading(true);
    const supabase = createClient();
    if (!supabase) { setPickerLoading(false); return; }
    const { data } = await supabase.from('classes').select('id, name, subjects(name)').order('name');
    const rows = (data ?? []) as unknown as { id: string; name: string; subjects: { name: string } | null }[];
    setSubjectOptions(rows.map((row) => ({ id: row.id, label: row.subjects?.name ?? row.name })));
    setPickerLoading(false);
  };

  const closePicker = () => setPickerStage('closed');

  const pickSubject = async (option: SubjectOption) => {
    setPickerLoading(true);
    setGuidedClassId(option.id);
    setGuidedLabel(option.label);
    const supabase = createClient();
    if (!supabase) { setPickerLoading(false); return; }
    const { data } = await supabase.from('materials').select('chapter').eq('class_id', option.id).eq('status', 'extracted');
    const chapters = [...new Set((data ?? []).map((row) => row.chapter).filter((chapter): chapter is string => Boolean(chapter)))];
    setChapterOptions(chapters);
    setPickerStage('chapter');
    setPickerLoading(false);
  };

  const startGuidedLesson = async (chapter: string | null) => {
    if (!guidedClassId) return;
    setGuidedChapter(chapter);
    setPickerStage('closed');
    setMessages([]);
    setActiveSessionId(null);
    setAttachments([]);
    setError(undefined);
    localStorage.setItem(activeChatStorageKey, NEW_CHAT_MARKER);
    await loadGuidedMaterials(guidedClassId, chapter);
  };

  const exitGuidedLesson = () => {
    setGuidedClassId(null);
    setGuidedChapter(null);
    setGuidedLabel('');
    setGuidedMaterials([]);
    setSelectedMaterialId(null);
    setMaterialFiles([]);
  };

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    const loadVoices = () => {
      setAvailableVoices(window.speechSynthesis?.getVoices() ?? []);
      setSelectedVoice((current) => current || localStorage.getItem('schoolbuddy-voice') || '');
    };
    const timer = window.setTimeout(loadVoices, 0);
    window.speechSynthesis?.addEventListener('voiceschanged', loadVoices);
    return () => { window.clearTimeout(timer); window.speechSynthesis?.removeEventListener('voiceschanged', loadVoices); };
  }, [stopRecorder]);

  const configureVoice = (utterance: SpeechSynthesisUtterance) => {
    const targetLang = SPEECH_LANG[language] ?? 'en-US';
    const languageCode = targetLang.split('-')[0];
    const candidates = availableVoices.filter((voice) => voice.lang === targetLang || voice.lang.startsWith(languageCode));
    const preferred = candidates.find((voice) => voice.name === selectedVoice) ?? [...candidates].sort((a, b) => {
      const score = (voice: SpeechSynthesisVoice) => /natural|enhanced|premium|neural/i.test(voice.name) ? 4 : /google|microsoft|samantha|daniel|karen|rishi/i.test(voice.name) ? 2 : voice.localService ? 1 : 0;
      return score(b) - score(a);
    })[0];
    if (preferred) utterance.voice = preferred;
    utterance.lang = preferred?.lang ?? targetLang;
    utterance.rate = 0.96;
    utterance.pitch = 1.02;
    utterance.volume = 1;
  };

  // Stop any in-progress speech when the page is left, so it never keeps
  // talking after the user has navigated away.
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
      recognitionRef.current?.abort();
      stopRecorder();
    };
  }, [stopRecorder]);

  const speak = (text: string, index: number) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    if (speakingIndex === index) {
      setSpeakingIndex(null);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(stripMarkdownForSpeech(text));
    configureVoice(utterance);
    utterance.onend = () => setSpeakingIndex(null);
    utterance.onerror = () => setSpeakingIndex(null);
    setSpeakingIndex(index);
    window.speechSynthesis.speak(utterance);
  };

  const stopConversation = () => {
    conversationRef.current = false;
    setConversationActive(false);
    setConversationListening(false);
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    stopRecorder();
    window.speechSynthesis?.cancel();
  };

  const startNewChat = () => {
    if (loading) return;
    if (messages.length === 0 && !activeSessionId && !guidedClassId) return;
    window.speechSynthesis?.cancel();
    recognitionRef.current?.abort();
    setMessages([]);
    setActiveSessionId(null);
    setError(undefined);
    setHistoryOpen(false);
    setAttachments([]);
    exitGuidedLesson();
    localStorage.setItem(activeChatStorageKey, NEW_CHAT_MARKER);
    if (role === 'student') openPicker();
  };

  const transcribeRecording = async (blob: Blob) => {
    setTranscribing(true);
    setError(undefined);
    try {
      const form = new FormData();
      form.append('audio', blob, 'voice-message.webm');
      form.append('language', language);
      const response = await fetch('/api/chat/transcribe', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Voice transcription failed.');
      const transcript = cleanVoiceTranscript(typeof data.transcript === 'string' ? data.transcript : '');
      if (!transcript) throw new Error('I could not hear that clearly. Please try again.');
      if (reviewVoiceBeforeSend) {
        setInput((current) => [current.trim(), transcript].filter(Boolean).join(' '));
        setError('Review the voice transcript, then press Send if it looks right.');
        stopConversation();
        return;
      }
      setInput((current) => [current.trim(), transcript].filter(Boolean).join(' '));
      if (conversationRef.current) {
        setConversationStatus('thinking');
        await sendMessage(transcript, messagesRef.current, true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Voice transcription failed.');
    } finally { setTranscribing(false); }
  };

  const startRecorderFallback = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Microphone recording requires Chrome, Edge, Safari, or Firefox over HTTPS or localhost.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      recordingChunksRef.current = [];
      recordingHeardSpeechRef.current = false;
      recordingPeakVolumeRef.current = 0;
      recorder.ondataavailable = (event) => { if (event.data.size) recordingChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const type = recorder.mimeType.split(';')[0] || 'audio/webm';
        const blob = new Blob(recordingChunksRef.current, { type });
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        if (voiceDetectionTimerRef.current) window.clearInterval(voiceDetectionTimerRef.current);
        voiceDetectionTimerRef.current = null;
        closeVoiceAudioContext();
        setDictationListening(false);
        setConversationListening(false);
        setRecordingFallback(false);
        if (!reviewVoiceBeforeSend && (!recordingHeardSpeechRef.current || recordingPeakVolumeRef.current < 0.018)) {
          setError('I could not hear speech clearly. Please try again closer to the microphone.');
          return;
        }
        if (blob.size) void transcribeRecording(blob);
      };
      recordingStreamRef.current = stream;
      recorderRef.current = recorder;
      recorder.start();
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const recordingStartedAt = new Date().getTime();
      let heardSpeech = false;
      let lastSpeechAt = recordingStartedAt;
      voiceAudioContextRef.current = audioContext;
      voiceDetectionTimerRef.current = window.setInterval(() => {
        if (recorder.state !== 'recording') return;
        analyser.getByteTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) { const normalized = (sample - 128) / 128; energy += normalized * normalized; }
        const volume = Math.sqrt(energy / samples.length);
        recordingPeakVolumeRef.current = Math.max(recordingPeakVolumeRef.current, volume);
        if (volume > 0.018) {
          heardSpeech = true;
          recordingHeardSpeechRef.current = true;
          lastSpeechAt = new Date().getTime();
        }
        const now = new Date().getTime();
        if ((heardSpeech && now - lastSpeechAt > 1300) || (reviewVoiceBeforeSend && now - recordingStartedAt > 5000) || now - recordingStartedAt > 30000) recorder.stop();
      }, 120);
      setRecordingFallback(true);
      if (conversationRef.current) setConversationListening(true);
      else setDictationListening(true);
      setError(undefined);
    } catch {
      setError('Microphone access was denied. Allow microphone permission in your browser and try again.');
    }
  };

  const toggleListening = () => {
    if (conversationRef.current) { stopConversation(); return; }
    if (conversationListening) {
      recognitionRef.current?.abort();
      stopRecorder();
      setConversationListening(false);
      return;
    }
    conversationRef.current = true;
    setConversationActive(true);
    setConversationStatus('listening');
    beginConversationListening();
  };

  const toggleDictation = () => {
    if (conversationRef.current || loading || transcribing) return;
    if (dictationListening) {
      recognitionRef.current?.stop();
      stopRecorder();
      setDictationListening(false);
      return;
    }

    const speechWindow = window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (useRecorderFirst || !Recognition || speechFailedRef.current) {
      void startRecorderFallback();
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = SPEECH_LANG[language] ?? 'en-US';
    const baseInput = input.trim();
    dictationFinalTranscriptRef.current = '';
    recognition.onresult = (event) => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) dictationFinalTranscriptRef.current += transcript;
        else interim += transcript;
      }
      const visibleTranscript = cleanVoiceTranscript([dictationFinalTranscriptRef.current, interim].join(' '));
      setInput([baseInput, visibleTranscript].filter(Boolean).join(' '));
    };
    recognition.onerror = () => {
      setDictationListening(false);
      recognitionRef.current = null;
      speechFailedRef.current = true;
      void startRecorderFallback();
    };
    recognition.onend = () => {
      setDictationListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    setError(undefined);
    setDictationListening(true);
    recognition.start();
  };

  const beginConversationListening = () => {
    if (!conversationRef.current) return;
    if (recordingFallback && recorderRef.current) { recorderRef.current.stop(); return; }
    const speechWindow = window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (useRecorderFirst || !Recognition || speechFailedRef.current) { void startRecorderFallback(); return; }
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = SPEECH_LANG[language] ?? 'en-US';
    voiceBaseRef.current = input.trim();
    conversationTranscriptRef.current = '';
    recognition.onresult = (event) => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) conversationTranscriptRef.current += transcript;
        else interim += transcript;
      }
      const visibleTranscript = cleanVoiceTranscript([conversationTranscriptRef.current, interim].join(' '));
      setInput([voiceBaseRef.current, visibleTranscript].filter(Boolean).join(' ').trimStart());
    };
    recognition.onerror = () => {
      speechFailedRef.current = true;
      setConversationListening(false);
      recognitionRef.current = null;
      if (conversationRef.current) void startRecorderFallback();
    };
    recognition.onend = () => {
      setConversationListening(false);
      recognitionRef.current = null;
      const transcript = conversationTranscriptRef.current.trim();
      if (!conversationRef.current) return;
      if (transcript) {
        const cleanedTranscript = cleanVoiceTranscript(transcript);
        if (reviewVoiceBeforeSend) {
          setInput([voiceBaseRef.current, cleanedTranscript].filter(Boolean).join(' ').trimStart());
          setError('Review the voice transcript, then press Send if it looks right.');
          stopConversation();
          return;
        }
        if (transcript.split(/\s+/).length > MAX_AUTO_SEND_TRANSCRIPT_WORDS) {
          setError('Voice transcript looked uncertain, so I left it in the message box for review.');
          return;
        }
        setConversationStatus('thinking');
        void sendMessage(cleanedTranscript, messagesRef.current, true);
      } else {
        window.setTimeout(() => beginConversationListening(), 250);
      }
    };
    recognitionRef.current = recognition;
    setError(undefined);
    setConversationListening(true);
    setConversationStatus('listening');
    recognition.start();
  };

  const addFiles = (files: File[]) => {
    const combined = [...attachments, ...files].slice(0, 3);
    if (files.some((file) => !CHAT_FILE_TYPES.includes(file.type))) { setError('Use PDF, TXT, JPG, PNG, or WebP files.'); return; }
    if (combined.reduce((total, file) => total + file.size, 0) > 10 * 1024 * 1024) { setError('Chat attachments must be 10MB or less in total.'); return; }
    setAttachments(combined);
    setError(undefined);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  };

  const encodeAttachments = (files: File[] = attachments) => Promise.all(files.map((file) => new Promise<{ name: string; mimeType: string; data: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, mimeType: file.type, data: String(reader.result).split(',')[1] ?? '' });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  })));

  const openSession = async (id: string) => {
    if (loading) return;
    const supabase = createClient();
    if (!supabase) return;
    window.speechSynthesis?.cancel();
    setHistoryOpen(false);
    setError(undefined);
    setLoading(true);
    try {
      const [{ data, error: loadError }, { data: sessionRow }] = await Promise.all([
        supabase
          .from('ai_chat_messages')
          .select('id, role, text, grounding, feedback, feedback_reason')
          .eq('session_id', id)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true }),
        supabase.from('ai_chat_sessions').select('class_id, chapter').eq('id', id).single(),
      ]);
      if (loadError) throw new Error(t('chat.historyLoadFailed'));
      setMessages(withAttachmentNames((data ?? []) as ChatMessage[]));
      setActiveSessionId(id);
      localStorage.setItem(activeChatStorageKey, id);
      if (sessionRow?.class_id) {
        setGuidedClassId(sessionRow.class_id);
        setGuidedChapter(sessionRow.chapter ?? null);
        await Promise.all([loadGuidedMaterials(sessionRow.class_id, sessionRow.chapter ?? null), loadGuidedLabel(sessionRow.class_id)]);
      } else {
        exitGuidedLesson();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('chat.historyLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const deleteSession = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (loading) return;
    if (!window.confirm(t('chat.deleteChatConfirm'))) return;
    const supabase = createClient();
    if (!supabase) return;
    await supabase.from('ai_chat_sessions').delete().eq('id', id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) startNewChat();
  };

  const renameSession = async (session: ChatSession, event: React.MouseEvent) => {
    event.stopPropagation();
    if (loading) return;
    const nextTitle = window.prompt('Rename conversation', session.title)?.trim();
    if (!nextTitle || nextTitle === session.title) return;
    const title = nextTitle.slice(0, 80);
    const supabase = createClient();
    if (!supabase) return;
    const { error: renameError } = await supabase.from('ai_chat_sessions').update({ title }).eq('id', session.id);
    if (renameError) {
      setError('This conversation could not be renamed.');
      return;
    }
    setSessions((current) => current.map((item) => item.id === session.id ? { ...item, title } : item));
  };

  const sendMessage = async (textValue: string, priorMessages: ChatMessage[] = messages, voiceTurn = false, filesOverride?: File[]) => {
    const text = textValue.trim();
    if (!text || loading) return;
    const filesToSend = filesOverride ?? attachments;
    const nextMessages: ChatMessage[] = [
      ...priorMessages,
      { role: 'user', text, attachmentNames: filesToSend.length ? filesToSend.map((file) => file.name) : undefined },
    ];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setInput('');
    setAttachments([]);
    setLoading(true);
    setError(undefined);

    try {
      const encodedAttachments = await encodeAttachments(filesOverride ?? filesToSend);
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages.map(({ role, text: messageText }) => ({ role, text: messageText })), sessionId: activeSessionId, language, attachments: encodedAttachments, classId: guidedClassId, chapter: guidedChapter }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      const assistantMessage: ChatMessage = { id: data.assistantMessageId, role: 'assistant', text: data.reply, grounding: data.grounding };
      setMessages((prev) => { const updated = [...prev, assistantMessage]; messagesRef.current = updated; return updated; });
      if (data.sessionId) {
        if (data.sessionId !== activeSessionId) setActiveSessionId(data.sessionId);
        localStorage.setItem(activeChatStorageKey, data.sessionId);
      }
      if (data.historySaved === false) setError(t('chat.historySaveFailed'));
      loadSessions();
      if (voiceTurn && conversationRef.current) {
        setConversationStatus('speaking');
        const utterance = new SpeechSynthesisUtterance(stripMarkdownForSpeech(data.reply));
        configureVoice(utterance);
        utterance.onend = () => { if (conversationRef.current) beginConversationListening(); };
        utterance.onerror = () => { if (conversationRef.current) beginConversationListening(); };
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
      if (voiceTurn) stopConversation();
    } finally {
      setLoading(false);
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }));
    }
  };

  // Declared after openSession/sendMessage so it can call them directly —
  // must run once both are defined for the same reason.
  useEffect(() => {
    const restoreChat = async () => {
      // A student arriving from the dashboard's Lessons landing either wants
      // to reopen a past conversation or send a fresh draft (possibly with
      // files/a voice transcript already attached) — either way, that takes
      // priority over the usual "restore whatever was last open" behavior.
      const handoff = takeChatHandoff();
      if (handoff?.openSessionId) {
        await loadSessions();
        await openSession(handoff.openSessionId);
        return;
      }
      if (handoff?.draft) {
        await loadSessions();
        await sendMessage(handoff.draft.text, [], false, handoff.draft.files);
        return;
      }

      const supabase = createClient();
      if (!supabase) return;
      const { data } = await supabase
        .from('ai_chat_sessions')
        .select('id, title, updated_at, class_id, chapter')
        .order('updated_at', { ascending: false });
      const restoredSessions = data ?? [];
      setSessions(restoredSessions);

      const storedSessionId = localStorage.getItem(activeChatStorageKey);
      if (storedSessionId === NEW_CHAT_MARKER) {
        if (role === 'student') openPicker();
        return;
      }
      const sessionToRestore = restoredSessions.find((session) => session.id === storedSessionId) ?? restoredSessions[0];
      if (!sessionToRestore) {
        if (role === 'student') openPicker();
        return;
      }

      const { data: restoredMessages, error: loadError } = await supabase
        .from('ai_chat_messages')
        .select('id, role, text, grounding, feedback, feedback_reason')
        .eq('session_id', sessionToRestore.id)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
      if (loadError) return;
      setMessages(withAttachmentNames((restoredMessages ?? []) as ChatMessage[]));
      setActiveSessionId(sessionToRestore.id);
      localStorage.setItem(activeChatStorageKey, sessionToRestore.id);
      if (sessionToRestore.class_id) {
        setGuidedClassId(sessionToRestore.class_id);
        setGuidedChapter(sessionToRestore.chapter ?? null);
        await Promise.all([loadGuidedMaterials(sessionToRestore.class_id, sessionToRestore.chapter ?? null), loadGuidedLabel(sessionToRestore.class_id)]);
      }
    };
    void restoreChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openSession/sendMessage are recreated every render; this must run once on mount, not on every keystroke.
  }, [activeChatStorageKey]);

  const send = async (event: FormEvent, override?: string) => {
    event.preventDefault();
    const text = (override ?? input).trim();
    await sendMessage(text);
  };

  const copyAnswer = async (text: string, index: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    window.setTimeout(() => setCopiedIndex((current) => current === index ? null : current), 1500);
  };

  const retryAnswer = async (index: number) => {
    const userMessage = messages[index - 1];
    if (!userMessage || userMessage.role !== 'user' || loading) return;
    const prior = messages.slice(0, index - 1);
    setFeedbackOpen(null);
    await sendMessage(userMessage.text, prior);
  };

  const saveFeedback = async (index: number, feedback: 1 | -1, reason?: FeedbackReason) => {
    const message = messages[index];
    if (!message?.id) return;
    const previous = message;
    setMessages((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, feedback, feedback_reason: reason ?? null } : item));
    setFeedbackOpen(feedback === -1 && !reason ? message.id : null);
    if (feedback === -1 && !reason) return;
    try {
      const response = await fetch('/api/chat/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId: message.id, feedback, reason }) });
      if (!response.ok) throw new Error();
      setFeedbackOpen(null);
    } catch {
      setMessages((current) => current.map((item, itemIndex) => itemIndex === index ? previous : item));
      setError('Feedback could not be saved. Please try again.');
    }
  };

  return (
    <div onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={handleDrop} className={`relative mx-auto flex h-[calc(100vh-5rem)] w-full flex-1 flex-col py-6 md:h-[calc(100vh-76px)] md:py-8 ${guidedClassId ? 'max-w-6xl px-4' : 'max-w-4xl px-6'}`}>
      {dragging && <div className="pointer-events-none absolute inset-4 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary-light/90 text-center text-sm font-bold text-primary shadow-lg">Drop up to 3 files here</div>}
      {conversationActive && <div className="absolute inset-x-6 bottom-24 z-20 rounded-2xl border border-primary/20 bg-[#171936] p-5 text-white shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3"><span className={`flex h-11 w-11 items-center justify-center rounded-full ${conversationStatus === 'listening' ? 'animate-pulse bg-danger' : 'bg-primary'}`}><MicIcon width={20} /></span><div><p className="font-heading text-base font-semibold">Voice conversation</p><p className="text-xs text-white/60">{conversationStatus === 'listening' ? 'Listening… speak naturally' : conversationStatus === 'thinking' ? 'Thinking…' : 'Speaking…'}</p></div></div>
          <button type="button" onClick={stopConversation} className="rounded-xl bg-danger px-4 py-2.5 text-sm font-bold text-white shadow-lg">Stop conversation</button>
        </div>
      </div>}
      <div className="animate-fade-up flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SparkleIcon width={20} height={20} className="text-accent" />
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{t('chat.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('chat.schoolSubtitle')}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {role === 'student' && (
            <button
              type="button"
              onClick={openPicker}
              disabled={loading}
              className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-foreground hover:bg-secondary"
            >
              <BookIcon width={16} height={16} />
              <span className="hidden sm:inline">{t('guided.chooseSubject')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={startNewChat}
            disabled={loading}
            aria-label={t('chat.newChat')}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground hover:bg-secondary"
          >
            <PlusIcon width={16} height={16} />
          </button>
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            disabled={loading}
            aria-label={t('chat.history')}
            className={`flex h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-secondary ${
              historyOpen ? 'bg-secondary text-primary' : 'text-foreground'
            }`}
          >
            <HistoryIcon width={16} height={16} />
            <span className="hidden sm:inline">{t('chat.history')}</span>
            {sessions.length > 0 && <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">{sessions.length}</span>}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex w-fit items-center rounded-xl bg-secondary p-1 text-xs font-bold">
          <span className="rounded-lg bg-card px-4 py-2 text-primary shadow-sm">Chat</span>
          <button type="button" onClick={toggleListening} title={reviewVoiceBeforeSend ? 'Start voice capture for review' : 'Start voice conversation'} className={`rounded-lg px-4 py-2 ${conversationActive ? 'bg-danger text-white' : 'text-muted-foreground hover:text-foreground'}`}>Voice <span className="ml-1 font-normal opacity-70">Beta</span></button>
          <span className="cursor-not-allowed rounded-lg px-4 py-2 text-muted-foreground/50" title="Planned for a future release">Avatar <span className="ml-1 font-normal">Soon</span></span>
        </div>
        {availableVoices.length > 0 && <div className="flex items-center gap-2 text-xs text-muted-foreground"><span>Voice</span><select value={selectedVoice} onChange={(event) => { setSelectedVoice(event.target.value); localStorage.setItem('schoolbuddy-voice', event.target.value); }} className="max-w-48 rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground"><option value="">Best available</option>{availableVoices.filter((voice) => voice.lang.startsWith((SPEECH_LANG[language] ?? 'en').split('-')[0])).map((voice, index) => <option key={`${voice.voiceURI}-${voice.lang}-${index}`} value={voice.name}>{voice.name}</option>)}</select></div>}
      </div>

      {historyOpen && <div className="fixed inset-0 z-10" onClick={() => setHistoryOpen(false)} />}

      {historyOpen && (
        <div className="absolute right-6 top-20 z-20 max-h-96 w-72 overflow-y-auto rounded-xl border border-border bg-card p-2 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('chat.history')}</p>
            <button type="button" onClick={() => setHistoryOpen(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
              <XIcon width={14} height={14} />
            </button>
          </div>
          {sessions.length > 0 && <input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Search conversations" className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />}
          {sessions.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">{t('chat.noHistory')}</p>}
          <div className="mt-2 space-y-3">
            {(['Today', 'Yesterday', 'Older'] as const).map((group) => {
              const now = new Date();
              const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
              const filtered = sessions.filter((session) => session.title.toLowerCase().includes(historySearch.trim().toLowerCase())).filter((session) => {
                const updated = new Date(session.updated_at).getTime();
                return group === 'Today' ? updated >= startToday : group === 'Yesterday' ? updated >= startToday - 86400000 && updated < startToday : updated < startToday - 86400000;
              });
              if (!filtered.length) return null;
              return <div key={group}><p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{group}</p><div className="space-y-0.5">{filtered.map((session) => (
              <div
                key={session.id}
                className={`flex items-center gap-1 rounded-lg pr-1 hover:bg-secondary ${
                  activeSessionId === session.id ? 'bg-primary-light text-primary' : 'text-foreground'
                }`}
              >
                <button
                  type="button"
                  onClick={() => openSession(session.id)}
                  className="min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-left text-sm"
                >
                  {session.title}
                </button>
                <button type="button" onClick={(event) => renameSession(session, event)} aria-label="Rename conversation" title="Rename" className="shrink-0 rounded px-1.5 py-1 text-[10px] font-bold text-muted-foreground hover:text-primary">Edit</button>
                <button
                  type="button"
                  onClick={(event) => deleteSession(session.id, event)}
                  aria-label={t('chat.deleteChat')}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-danger"
                >
                  <TrashIcon width={13} height={13} />
                </button>
              </div>
              ))}</div></div>;
            })}
            {sessions.length > 0 && !sessions.some((session) => session.title.toLowerCase().includes(historySearch.trim().toLowerCase())) && <p className="px-2 py-3 text-sm text-muted-foreground">No matching conversations.</p>}
          </div>
        </div>
      )}

      {guidedClassId && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary-light px-3 py-2 text-xs font-semibold text-primary">
          <BookIcon width={14} height={14} />
          <span className="truncate">{guidedLabel || t('guided.subject')}{guidedChapter ? ` · ${guidedChapter}` : ''}</span>
          <button type="button" onClick={exitGuidedLesson} className="ml-auto shrink-0 rounded-md px-2 py-1 text-primary/70 hover:bg-card hover:text-primary">
            {t('guided.exit')}
          </button>
        </div>
      )}

      <div className={guidedClassId ? 'mt-4 grid flex-1 gap-4 overflow-hidden lg:grid-cols-[240px_1fr_260px]' : 'flex flex-1 flex-col'}>
        {guidedClassId && (
          <aside className="hidden overflow-y-auto rounded-xl border border-border bg-card p-3 lg:block">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t('guided.materials')}</p>
            <div className="mt-2 space-y-1.5">
              {guidedMaterials.length === 0 && <p className="text-xs text-muted-foreground">{t('guided.noMaterials')}</p>}
              {guidedMaterials.map((material) => (
                <button
                  key={material.id}
                  type="button"
                  onClick={() => selectGuidedMaterial(material)}
                  className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-xs ${
                    selectedMaterialId === material.id ? 'border-primary bg-primary-light text-primary' : 'border-border text-foreground hover:bg-secondary'
                  }`}
                >
                  <FileTextIcon width={13} className="mt-0.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{material.title}</span>
                    {material.chapter && <span className="block truncate text-[10px] text-muted-foreground">{material.chapter}</span>}
                  </span>
                </button>
              ))}
            </div>
            {materialFilesLoading && <p className="mt-3 text-xs text-muted-foreground">{t('common.loading')}</p>}
            {materialFiles.length > 0 && (
              <div className="mt-3 space-y-2 border-t border-border-soft pt-3">
                {materialFiles.map((file) => (
                  <div key={file.path} className="rounded-lg border border-border p-1.5">
                    {file.mime.startsWith('image/') ? (
                      // eslint-disable-next-line @next/next/no-img-element -- signed Supabase Storage URL, not a static asset next/image can optimize.
                      <img src={file.url} alt="" className="max-h-40 w-full rounded object-contain" />
                    ) : file.mime === 'application/pdf' ? (
                      <embed src={file.url} type="application/pdf" className="h-40 w-full rounded" />
                    ) : (
                      <a href={file.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary underline">{t('guided.openFile')}</a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <div className="animate-fade-up flex h-full flex-col items-center justify-center text-center" style={{ animationDelay: '0.08s' }}>
            <div className="ai-glow flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10">
              <SparkleIcon width={26} height={26} className="text-accent" />
            </div>
            {chatLocked ? (
              <>
                <h2 className="mt-4 text-base font-semibold text-foreground">{t('guided.pickSubjectFirst')}</h2>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">{t('guided.pickSubjectFirstHint')}</p>
                <button
                  type="button"
                  onClick={openPicker}
                  className="mt-6 flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground"
                >
                  <BookIcon width={16} height={16} />
                  {t('guided.chooseSubject')}
                </button>
              </>
            ) : (
              <>
                <h2 className="mt-4 text-base font-semibold text-foreground">{t('chat.howCanIHelp')}</h2>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">{t('chat.tryOneOfThese')}</p>
                <div className="mt-6 grid w-full max-w-md gap-2 sm:grid-cols-2">
                  {suggestedPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={(event) => send(event, prompt)}
                      className="rounded-lg border border-border bg-card px-3 py-2.5 text-left text-xs font-medium text-foreground shadow-sm hover:bg-secondary"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {messages.map((message, i) => (
          <div
            key={i}
            className={`animate-fade-up flex items-end gap-2 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
            style={{ animationDelay: '0.02s' }}
          >
            {message.role === 'assistant' && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                <SparkleIcon width={13} height={13} />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                message.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border bg-card text-foreground shadow-sm'
              }`}
            >
              {message.role === 'assistant' ? (
                <div className="[&_p]:leading-relaxed">
                  <ReactMarkdown components={markdownComponents}>{message.text}</ReactMarkdown>
                </div>
              ) : (
                message.text
              )}
              {message.role === 'user' && message.attachmentNames && message.attachmentNames.length > 0 && (
                <div className="mt-1.5 flex flex-wrap justify-end gap-1">
                  {message.attachmentNames.map((name, nameIndex) => (
                    <span
                      key={`${name}-${nameIndex}`}
                      className="flex max-w-full items-center gap-1 rounded-md bg-primary-foreground/15 px-2 py-1 text-xs text-primary-foreground"
                    >
                      <PaperclipIcon width={11} className="shrink-0" />
                      <span className="truncate">{name}</span>
                    </span>
                  ))}
                </div>
              )}
              {message.role === 'assistant' && <ChatSources grounding={message.grounding} />}
              {message.role === 'assistant' && (
                <div className="mt-2 border-t border-border-soft pt-2">
                  <div className="flex flex-wrap items-center gap-1">
                    <button type="button" onClick={() => speak(message.text, i)} aria-label={speakingIndex === i ? t('chat.stop') : t('chat.listen')} title={speakingIndex === i ? t('chat.stop') : t('chat.listen')} className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-primary">
                      {speakingIndex === i ? <SpeakerOffIcon width={13} /> : <SpeakerIcon width={13} />}{speakingIndex === i ? t('chat.stop') : t('chat.listen')}
                    </button>
                    <button type="button" onClick={() => copyAnswer(message.text, i)} title="Copy answer" className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-primary"><CopyIcon width={13} />{copiedIndex === i ? 'Copied' : 'Copy'}</button>
                    <button type="button" onClick={() => retryAnswer(i)} disabled={loading} title="Try this answer again" className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-primary disabled:opacity-40"><RefreshIcon width={13} />Retry</button>
                    {message.id && <>
                      <span className="mx-1 h-4 w-px bg-border-soft" />
                      <button type="button" onClick={() => saveFeedback(i, 1)} aria-label="Helpful answer" title="Helpful" className={`flex h-7 w-7 items-center justify-center rounded-md ${message.feedback === 1 ? 'bg-success/10 text-success' : 'text-muted-foreground hover:bg-secondary hover:text-success'}`}><ThumbUpIcon width={13} /></button>
                      <button type="button" onClick={() => saveFeedback(i, -1)} aria-label="Not helpful answer" title="Not helpful" className={`flex h-7 w-7 items-center justify-center rounded-md ${message.feedback === -1 ? 'bg-danger/10 text-danger' : 'text-muted-foreground hover:bg-secondary hover:text-danger'}`}><ThumbDownIcon width={13} /></button>
                    </>}
                  </div>
                  {message.id && feedbackOpen === message.id && (
                    <div className="mt-2 rounded-lg bg-danger/5 p-2">
                      <p className="text-xs font-semibold text-foreground">What could be better?</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {FEEDBACK_REASONS.map((reason) => <button key={reason.value} type="button" onClick={() => saveFeedback(i, -1, reason.value)} className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:border-danger hover:text-danger">{reason.label}</button>)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-end gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
              <SparkleIcon width={13} height={13} />
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-3 shadow-sm">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: '0ms' }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: '150ms' }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>

      <form onSubmit={send} className="mt-3 w-full rounded-2xl border border-border bg-card p-3 shadow-md">
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={chatLocked ? t('guided.pickSubjectFirst') : t('chat.placeholder')}
          disabled={chatLocked}
          className="w-full bg-transparent px-2 py-1.5 text-sm text-foreground outline-none disabled:cursor-not-allowed"
        />
        {attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2 px-2">
            {attachments.map((file, index) => (
              <div key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs shadow-sm">
                <PaperclipIcon width={12} className="text-primary" />
                <span className="max-w-32 truncate font-semibold text-foreground">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  aria-label={`Remove ${file.name}`}
                  className="text-muted-foreground hover:text-danger"
                >
                  <XIcon width={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        {dictationListening && !conversationActive && (
          <p className="mt-2 px-2 text-xs font-semibold text-danger">
            {useRecorderFirst ? 'Listening — transcript appears after you pause' : 'Listening — your words appear below in real time'}
          </p>
        )}
        {transcribing && <p className="mt-2 px-2 text-xs font-semibold text-primary">Transcribing your recording…</p>}
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-border-soft pt-2">
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" multiple accept=".pdf,.txt,.jpg,.jpeg,.png,.webp" className="hidden" onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading || chatLocked || attachments.length >= 3}
              aria-label="Attach files"
              title="Attach files"
              className="flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-40"
            >
              <PaperclipIcon width={14} />
              {t('lessons.upload')}
            </button>
            <button
              type="button"
              onClick={toggleDictation}
              disabled={loading || chatLocked || transcribing || conversationActive}
              aria-label={dictationListening ? 'Stop voice dictation' : 'Start voice dictation'}
              title={dictationListening ? 'Stop dictation' : 'Dictate message'}
              className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold disabled:opacity-40 ${
                dictationListening ? 'border-danger bg-danger/10 text-danger' : 'border-border text-foreground hover:bg-secondary'
              }`}
            >
              <MicIcon width={14} />
              {dictationListening ? t('lessons.recording') : transcribing ? t('lessons.transcribing') : t('lessons.record')}
            </button>
          </div>
          <button
            type="submit"
            disabled={!input.trim() || loading || chatLocked}
            aria-label="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground disabled:opacity-50"
          >
            <SendIcon className="h-4 w-4" />
          </button>
        </div>
      </form>
        </div>

        {guidedClassId && (
          <aside className="hidden overflow-y-auto rounded-xl border border-border bg-card p-3 lg:block">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t('guided.videos')}</p>
            {(selectedMaterialId ? guidedMaterials.filter((material) => material.id === selectedMaterialId) : guidedMaterials).filter((material) => material.video_url).length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">{t('guided.noVideos')}</p>
            )}
            <div className="mt-2 space-y-3">
              {(selectedMaterialId ? guidedMaterials.filter((material) => material.id === selectedMaterialId) : guidedMaterials)
                .filter((material) => material.video_url)
                .map((material) => {
                  const embedUrl = material.video_url ? getVideoEmbedUrl(material.video_url) : null;
                  return (
                    <div key={material.id} className="rounded-lg border border-border-soft p-2">
                      <p className="text-xs font-semibold text-foreground">{material.title}</p>
                      {embedUrl ? (
                        <div className="mt-2 aspect-video w-full overflow-hidden rounded-lg">
                          <iframe src={embedUrl} title={material.title} allowFullScreen className="h-full w-full" />
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">{t('guided.noVideos')}</p>
                      )}
                    </div>
                  );
                })}
            </div>
          </aside>
        )}
      </div>

      {pickerStage !== 'closed' && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={closePicker}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground">{pickerStage === 'subject' ? t('guided.pickSubject') : t('guided.pickChapter')}</h3>
              <button type="button" onClick={closePicker} aria-label="Close" className="text-muted-foreground hover:text-foreground">
                <XIcon width={16} height={16} />
              </button>
            </div>
            {pickerLoading && <p className="mt-4 text-sm text-muted-foreground">{t('common.loading')}</p>}
            {!pickerLoading && pickerStage === 'subject' && (
              <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
                {subjectOptions.length === 0 && <p className="text-sm text-muted-foreground">{t('guided.noSubjects')}</p>}
                {subjectOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => pickSubject(option)}
                    className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-secondary"
                  >
                    <BookIcon width={14} height={14} /> {option.label}
                  </button>
                ))}
              </div>
            )}
            {!pickerLoading && pickerStage === 'chapter' && (
              <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
                {chapterOptions.length === 0 && <p className="text-sm text-muted-foreground">{t('guided.noChapters')}</p>}
                {chapterOptions.map((chapter) => (
                  <button
                    key={chapter}
                    type="button"
                    onClick={() => startGuidedLesson(chapter)}
                    className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-secondary"
                  >
                    <CheckIcon width={14} height={14} /> {chapter}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => startGuidedLesson(null)}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-secondary"
                >
                  {t('guided.continueWithoutChapter')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
