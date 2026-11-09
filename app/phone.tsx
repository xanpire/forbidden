// The player's phone: text threads, contacts and group chats. Texts people send
// back land in story time (lib/rpg/phone.ts); "Wait for a reply" moves the
// story clock to the next one. Pictures in texts are painted when opened.
import { router } from 'expo-router';
import { ArrowLeft, ArrowUp, Image as ImageIcon, Users } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { EmptyRow, ListCard, ListRow, SectionLabel } from '@/components/List';
import { colors, fonts, radius, spacing, type } from '@/constants/theme';
import { formatClock, sameDate, weekdayOf } from '@/lib/rpg/calendar';
import { addExplicitRef } from '@/lib/rpg/explicitImages';
import { useGame } from '@/lib/rpg/game';
import { ensureImageCaps } from '@/lib/rpg/imageCaps';
import { storeImage, useStoredImage } from '@/lib/rpg/imageStore';
import { paintTextPhoto } from '@/lib/rpg/paintScene';
import {
  PLAYER,
  contactsOf,
  createGroup,
  ensureThread,
  isTyping,
  markThreadRead,
  nextPhoneEvent,
  phoneOf,
  senderName,
  threadMessages,
  threadTitle,
  threadsByRecent,
  unreadCount,
} from '@/lib/rpg/phone';
import { displayName } from '@/lib/rpg/names';
import type { AppDatabase, CalendarDate, PhoneMessage } from '@/lib/rpg/types';

type View_ = { kind: 'list' } | { kind: 'thread'; id: string } | { kind: 'new' } | { kind: 'group' };

function when(db: AppDatabase, date: CalendarDate) {
  return sameDate(date, db.state.inStoryDate) ? formatClock(date) : `${weekdayOf(date).slice(0, 3)} ${formatClock(date)}`;
}

function Photo({ message, onOpen, busy }: { message: PhoneMessage; onOpen: () => void; busy: boolean }) {
  const src = useStoredImage(message.photo?.image);

  if (src) return <Image accessibilityLabel={message.photo?.description} source={{ uri: src }} style={styles.photo} />;

  return (
    <Pressable accessibilityLabel="Open the photo" accessibilityRole="button" disabled={busy} onPress={onOpen} style={({ pressed }) => [styles.photoClosed, pressed && styles.pressed]}>
      {busy ? <ActivityIndicator color={colors.text} size="small" /> : <ImageIcon color={colors.textMuted} size={18} />}
      <Text style={styles.photoLabel}>{busy ? 'Opening…' : 'Photo · tap to open'}</Text>
    </Pressable>
  );
}

function Thread({ db, threadId, onBack }: { db: AppDatabase; threadId: string; onBack: () => void }) {
  const { sendText, waitForText, changeSave, apiKey, updateSettings } = useGame();
  const [draft, setDraft] = useState('');
  const [painting, setPainting] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const thread = phoneOf(db).threads.find((item) => item.id === threadId);
  const messages = threadMessages(db, threadId);
  const typing = isTyping(db, threadId);
  const waiting = Boolean(nextPhoneEvent(db));
  const unread = unreadCount(db, threadId);

  useEffect(() => {
    if (unread > 0) void changeSave((latest) => markThreadRead(latest, threadId));
  }, [changeSave, threadId, unread]);

  if (!thread) return null;

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    await sendText(threadId, text);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  };

  const openPhoto = async (message: PhoneMessage) => {
    if (!message.photo || !apiKey) {
      setNote('Add your OpenRouter key in Settings to open photos.');
      return;
    }
    setPainting(message.id);
    setNote(null);
    try {
      const caps = await ensureImageCaps(db, updateSettings);
      const result = await paintTextPhoto({ apiKey, db, caps, senderId: message.from, description: message.photo.description, updateSettings, onWarning: setNote });
      for (const sheet of result.refSheets) {
        const stored = await storeImage(sheet.image);
        await changeSave((latest) => addExplicitRef(latest, sheet.entityId, stored));
      }
      const stored = await storeImage(result.take.dataUri);
      await changeSave((latest) => {
        const phone = phoneOf(latest);
        return { ...latest, phone: { ...phone, messages: phone.messages.map((item) => (item.id === message.id && item.photo ? { ...item, photo: { ...item.photo, image: stored } } : item)) } };
      });
    } catch (caught) {
      setNote(caught instanceof Error ? caught.message : 'The photo could not be opened.');
    } finally {
      setPainting(null);
    }
  };

  const lastPlayer = [...messages].reverse().find((message) => message.from === PLAYER);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <View style={styles.threadHeader}>
        <Pressable accessibilityLabel="Back to messages" accessibilityRole="button" hitSlop={8} onPress={onBack}>
          <ArrowLeft color={colors.text} size={20} />
        </Pressable>
        <View style={styles.flex}>
          <Text numberOfLines={1} style={type.heading}>{threadTitle(db, thread)}</Text>
          {thread.group ? <Text numberOfLines={1} style={type.rowMeta}>{thread.members.map((id) => displayName(db, db.entities.find((entity) => entity.id === id))).join(', ')}</Text> : null}
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.bubbles} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })} ref={scroll}>
        {messages.length === 0 ? <Text style={styles.empty}>No messages yet.</Text> : null}
        {messages.map((message, index) => {
          const mine = message.from === PLAYER;
          const showName = thread.group && !mine && messages[index - 1]?.from !== message.from;
          return (
            <View key={message.id} style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
              {showName ? <Text style={styles.sender}>{senderName(db, message.from)}</Text> : null}
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                {message.photo ? <Photo busy={painting === message.id} message={message} onOpen={() => void openPhoto(message)} /> : null}
                {message.text ? <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{message.text}</Text> : null}
              </View>
              <Text style={styles.time}>{when(db, message.at)}</Text>
            </View>
          );
        })}
        {thread.readAt && lastPlayer && !typing ? <Text style={styles.receipt}>Read {when(db, thread.readAt)}</Text> : null}
        {typing ? <Text style={styles.typing}>typing…</Text> : null}
      </ScrollView>
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {waiting ? (
        <AppButton compact label="Wait for a reply" onPress={() => void waitForText()} style={styles.wait} variant="secondary" />
      ) : null}
      <View style={styles.composer}>
        <TextInput
          accessibilityLabel="Text message"
          multiline
          onChangeText={setDraft}
          placeholder="Text message"
          placeholderTextColor={colors.textDim}
          style={styles.input}
          value={draft}
        />
        <Pressable accessibilityLabel="Send" accessibilityRole="button" disabled={!draft.trim()} onPress={() => void send()} style={({ pressed }) => [styles.send, !draft.trim() && styles.disabled, pressed && styles.pressed]}>
          <ArrowUp color={colors.onAccent} size={18} strokeWidth={2.4} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

export default function PhoneScreen() {
  const { db, changeSave } = useGame();
  const [view, setView] = useState<View_>({ kind: 'list' });
  const [picked, setPicked] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const threads = useMemo(() => (db ? threadsByRecent(db) : []), [db]);

  if (!db) return null;

  const contacts = contactsOf(db);

  const openWith = async (entityId: string) => {
    let id = '';
    await changeSave((latest) => {
      const opened = ensureThread(latest, [entityId]);
      id = opened.thread.id;
      return opened.db;
    });
    setView({ kind: 'thread', id });
  };

  const makeGroup = async () => {
    let id = '';
    await changeSave((latest) => {
      const made = createGroup(latest, picked, groupName);
      id = made.thread.id;
      return made.db;
    });
    setPicked([]);
    setGroupName('');
    setView({ kind: 'thread', id });
  };

  return (
    <SafeAreaView style={styles.root}>
      {view.kind === 'thread' ? (
        <Thread db={db} onBack={() => setView({ kind: 'list' })} threadId={view.id} />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.titleRow}>
            <Pressable accessibilityLabel={view.kind === 'list' ? 'Back to the story' : 'Back to messages'} accessibilityRole="button" hitSlop={8} onPress={() => (view.kind === 'list' ? router.back() : setView({ kind: 'list' }))}>
              <ArrowLeft color={colors.text} size={20} />
            </Pressable>
            <Text style={type.pageTitle}>{view.kind === 'list' ? 'Messages' : view.kind === 'new' ? 'New message' : 'New group'}</Text>
          </View>
          {view.kind === 'list' ? (
            <>
              <View style={styles.actions}>
                <AppButton compact disabled={contacts.length === 0} label="New message" onPress={() => setView({ kind: 'new' })} variant="secondary" />
                <AppButton compact disabled={contacts.length < 2} icon={<Users color={colors.text} size={14} />} label="New group" onPress={() => setView({ kind: 'group' })} variant="secondary" />
              </View>
              {threads.length === 0 ? (
                <EmptyRow body="Swap numbers with someone in the story and they show up here. People can text you too." title="No messages yet" />
              ) : (
                <ListCard>
                  {threads.map((thread) => {
                    const last = threadMessages(db, thread.id).slice(-1)[0];
                    const unread = unreadCount(db, thread.id);
                    return (
                      <ListRow
                        body={isTyping(db, thread.id) ? 'typing…' : last ? `${last.from === PLAYER ? 'You: ' : ''}${last.text || (last.photo ? 'Photo' : '')}` : 'No messages yet'}
                        bodyLines={1}
                        key={thread.id}
                        meta={last ? when(db, last.at) : null}
                        onPress={() => setView({ kind: 'thread', id: thread.id })}
                        title={threadTitle(db, thread)}
                        trailing={unread ? <View style={styles.badge}><Text style={styles.badgeText}>{unread}</Text></View> : null}
                      />
                    );
                  })}
                </ListCard>
              )}
            </>
          ) : null}
          {view.kind === 'new' ? (
            <>
              <SectionLabel first>Contacts</SectionLabel>
              <ListCard>
                {contacts.map((entity) => (
                  <ListRow chevron key={entity.id} onPress={() => void openWith(entity.id)} title={displayName(db, entity)} />
                ))}
              </ListCard>
            </>
          ) : null}
          {view.kind === 'group' ? (
            <>
              <TextInput accessibilityLabel="Group name" onChangeText={setGroupName} placeholder="Group name (optional)" placeholderTextColor={colors.textDim} style={styles.field} value={groupName} />
              <SectionLabel>Who's in it</SectionLabel>
              <ListCard>
                {contacts.map((entity) => {
                  const on = picked.includes(entity.id);
                  return (
                    <ListRow
                      accessibilityRole="switch"
                      accessibilityState={{ checked: on }}
                      key={entity.id}
                      onPress={() => setPicked((list) => (on ? list.filter((id) => id !== entity.id) : [...list, entity.id]))}
                      title={displayName(db, entity)}
                      trailing={<Text style={on ? styles.checkOn : styles.check}>{on ? '✓' : ''}</Text>}
                    />
                  );
                })}
              </ListCard>
              <AppButton disabled={picked.length < 2} label="Start group" onPress={() => void makeGroup()} />
            </>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  body: { padding: spacing.lg, gap: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm },
  badge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: radius.full, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: fonts.bold, fontSize: 11, color: colors.onAccent },
  threadHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  bubbles: { padding: spacing.lg, gap: spacing.sm },
  empty: { ...type.rowMeta, textAlign: 'center', marginTop: spacing.xl },
  bubbleRow: { alignItems: 'flex-start', maxWidth: '82%' },
  bubbleRowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  sender: { ...type.rowMeta, marginBottom: 2 },
  bubble: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.xl, gap: 6 },
  bubbleMine: { backgroundColor: colors.accent, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: colors.surfaceSoft, borderBottomLeftRadius: 4 },
  bubbleText: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.text },
  bubbleTextMine: { color: colors.onAccent },
  time: { fontFamily: fonts.medium, fontSize: 10, color: colors.textDim, marginTop: 2 },
  receipt: { fontFamily: fonts.medium, fontSize: 11, color: colors.textDim, alignSelf: 'flex-end' },
  typing: { fontFamily: fonts.medium, fontSize: 13, color: colors.textMuted, fontStyle: 'italic' },
  photo: { width: 220, height: 220, borderRadius: radius.lg },
  photoClosed: { width: 200, height: 120, borderRadius: radius.lg, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center', gap: 6 },
  photoLabel: { ...type.rowMeta },
  note: { ...type.rowMeta, color: colors.warning, paddingHorizontal: spacing.lg },
  wait: { alignSelf: 'center', marginBottom: spacing.sm },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.hairline },
  input: { flex: 1, minHeight: 40, maxHeight: 120, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.xl, backgroundColor: colors.surfaceRaised, color: colors.text, fontFamily: fonts.regular, fontSize: 15 },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  field: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.lg, backgroundColor: colors.surfaceRaised, color: colors.text, fontFamily: fonts.regular, fontSize: 15 },
  check: { width: 18, color: colors.textDim },
  checkOn: { width: 18, color: colors.accentText, fontFamily: fonts.bold },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
