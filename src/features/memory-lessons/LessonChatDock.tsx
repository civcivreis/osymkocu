import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { usePairedStudy } from '@/src/features/memory-lessons/usePairedStudy';
import { usePairChatStore } from '@/src/features/study/pairChatStore';
import { useStudyRoomMessages, type StudyRoomMessage } from '@/src/features/study/useStudyTogether';
import { AIService } from '@/src/lib/ai/AIService';
import { getSupabase } from '@/src/lib/supabase/client';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

import { looksLikeQuestion } from './motivation';

type ThreadRow = {
  id: string;
  kind: string;
  body: string;
  sender_id: string | null;
  created_at: string;
  event_type?: string | null;
};

export function LessonChatDock({
  lessonId,
  seed,
}: {
  lessonId: string;
  seed: string[];
}) {
  const { colors, radius } = useAppTheme();
  const { isDesktop } = useBreakpoint();
  const userId = useAuthStore((s) => s.session?.user.id);
  const pair = usePairChatStore((s) => s.session);
  const markSolo = usePairChatStore((s) => s.markSolo);
  const paired = usePairedStudy(null);
  const myName = (useAuthStore((s) => s.profile?.display_name) ?? 'Sen').split(/[\s#]/)[0];
  const pairMessages = useStudyRoomMessages(pair?.sessionId ?? null);
  const [rows, setRows] = useState<ThreadRow[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [soloContinue, setSoloContinue] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const joined = useRef(false);

  useEffect(() => {
    let alive = true;
    void getSupabase()
      .from('lesson_thread_messages')
      .select('id, kind, body, sender_id, created_at')
      .eq('lesson_id', lessonId)
      .order('created_at', { ascending: true })
      .limit(80)
      .then(({ data }) => {
        if (alive) setRows((data ?? []) as ThreadRow[]);
      });
    return () => {
      alive = false;
    };
  }, [lessonId]);

  useEffect(() => {
    if (!seed.length) return;
    setRows((prev) => {
      const have = new Set(prev.map((row) => row.body));
      const extra = seed
        .filter((line) => !have.has(line))
        .map((body, index) => ({
          id: `seed-${body}-${index}`,
          kind: 'study_event',
          body,
          sender_id: userId ?? null,
          created_at: new Date().toISOString(),
        }));
      return extra.length ? [...prev, ...extra] : prev;
    });
  }, [lessonId, seed, userId]);

  useEffect(() => {
    if (!pair?.sessionId || joined.current) return;
    joined.current = true;
    void paired.postEvent.mutateAsync({
      event: 'match_joined',
      body: `${myName} çalışmaya katıldı.`,
    });
    void paired.postEvent.mutateAsync({
      event: 'same_topic',
      body: 'Aynı konu üzerinde çalışıyorsunuz.',
    });
  }, [myName, pair?.sessionId]);

  const pushLocal = async (kind: string, body: string) => {
    if (!userId) return;
    const { data } = await getSupabase()
      .from('lesson_thread_messages')
      .insert({ lesson_id: lessonId, sender_id: userId, kind, body })
      .select('id, kind, body, sender_id, created_at')
      .single();
    if (data) setRows((prev) => [...prev, data as ThreadRow]);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    setBusy(true);
    try {
      if (pair?.sessionId) {
        await pairMessages.send.mutateAsync(text);
        if (looksLikeQuestion(text)) {
          const result = await AIService.generateExplanation({ question: text, mode: 'simple' });
          const reply = (result.reply || result.solution || result.answer || '').trim();
          if (reply) await paired.postEvent.mutateAsync({ event: 'coach', body: reply });
        }
      } else {
        await pushLocal('peer', text);
        if (looksLikeQuestion(text)) {
          const result = await AIService.generateExplanation({ question: text, mode: 'simple' });
          const reply = (result.reply || result.solution || result.answer || '').trim();
          if (reply) await pushLocal('coach', reply);
        }
      }
    } catch {
      await pushLocal('coach', 'Şu an yanıtlayamadım. Biraz sonra tekrar dene.');
    } finally {
      setBusy(false);
    }
  };

  const stream: ThreadRow[] = useMemo(() => {
    if (pair?.sessionId) {
      return (pairMessages.data ?? []).map((item: StudyRoomMessage) => ({
        id: item.id,
        kind: item.kind ?? 'user_message',
        body: item.body,
        sender_id: item.sender_id,
        created_at: item.created_at,
        event_type: item.event_type ?? undefined,
      }));
    }
    return rows;
  }, [pair?.sessionId, pairMessages.data, rows]);

  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [stream.length]);

  const partner = paired.partner;
  const partnerLeft = (pairMessages.data ?? []).some((row) => row.event_type === 'left' && row.sender_id !== userId);
  const reconnecting = Boolean(pair?.sessionId && partner?.stale && !partner?.disconnected && !soloContinue && !pair?.solo);
  const dropped = Boolean(pair?.sessionId && (partner?.disconnected || partnerLeft) && !soloContinue && !pair?.solo);

  return (
    <View
      style={{
        minHeight: isDesktop ? 180 : 148,
        maxHeight: isDesktop ? 320 : 220,
        borderTopWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: 10,
        gap: 8,
      }}>
      <AppText variant="label" tone="accent">
        {pair?.sessionId ? 'BİRLİKTE ÇALIŞMA' : 'ÇALIŞMA AKIŞI'}
      </AppText>
      <ScrollView ref={scroll} style={{ flex: 1, minHeight: 88 }} contentContainerStyle={{ gap: 6, paddingBottom: 4 }}>
        {stream.slice(-24).map((row) => (
          <FlowLine key={row.id} row={row} me={userId} otherName={pair?.otherName} />
        ))}
        {reconnecting ? (
          <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
            {pair?.otherName.split(/[\s#]/)[0]} yeniden bağlanıyor...
          </AppText>
        ) : null}
        {dropped ? (
          <View style={{ gap: 6, alignItems: 'center' }}>
            <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
              {partnerLeft
              ? `${pair?.otherName.split(/[\s#]/)[0]} çalışmadan ayrıldı.`
              : `${pair?.otherName.split(/[\s#]/)[0]} bağlantıyı kaybetti. Tek başına devam edebilirsin.`}
            </AppText>
            <Pressable
              onPress={() => {
                setSoloContinue(true);
                markSolo();
              }}
              style={{ paddingVertical: 4 }}>
              <AppText variant="caption" tone="accent">
                Tek başına devam et
              </AppText>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Mesaj yaz..."
          style={{
            flex: 1,
            minHeight: 40,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            paddingHorizontal: 12,
            backgroundColor: '#fff',
          }}
        />
        <Pressable
          onPress={() => void send()}
          style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 12, backgroundColor: '#C45C26', justifyContent: 'center' }}>
          <AppText tone="inverse">{busy ? '…' : 'Gönder'}</AppText>
        </Pressable>
      </View>
    </View>
  );
}

function FlowLine({
  row,
  me,
  otherName,
}: {
  row: ThreadRow;
  me?: string;
  otherName?: string;
}) {
  const event = row.kind === 'study_event' || row.kind === 'motivation' || row.event_type;
  if (row.kind === 'coach' || row.kind === 'coach_message' || row.event_type === 'coach') {
    return (
      <AppText variant="caption" tone="muted">
        Koç: {row.body}
      </AppText>
    );
  }
  if (event) {
    return (
      <AppText variant="caption" tone="muted" style={{ textAlign: 'center', paddingHorizontal: 12, opacity: 0.85 }}>
        {row.body.replace(/^Sistem:\s*/i, '')}
      </AppText>
    );
  }
  const mine = row.sender_id === me;
  const name = mine ? 'Sen' : otherName?.split(/[\s#]/)[0] || 'Arkadaşın';
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <AppText variant="caption" style={{ fontWeight: '700' }}>
        {name}
      </AppText>
      <AppText variant="caption">{row.body}</AppText>
    </View>
  );
}
