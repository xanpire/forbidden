// The scrapbook (living-world Stage 4, section 15).
//
// Every scene image you asked for, kept like photos of your life: sorted by
// date and chapter, each with a short caption, its in-story date, where you
// were and how old you were. Nothing is stored twice: it is read from the
// story log (rawLog[].image and imageMeta) and the chapters.

import { dateSortValue } from './calendar';
import { playerAgeAt, playerDisplayNames } from './player';
import type { AppDatabase, CalendarDate, RawLogEntry } from './types';
import { firstSentences, secondPerson } from './util';

export type ScrapbookPhoto = {
  logId: string;
  image: string;
  date: CalendarDate;
  chapter: number;
  caption: string;
  place: string | null;
  age: number;
};

export type ScrapbookChapter = {
  chapter: number;
  title: string | null;
  photos: ScrapbookPhoto[];
};

const CAPTION_LENGTH = 150;

/**
 * A photo's caption: the one written for it in your words when the image was
 * made, else the reply's opening sentence (the narrator already says "you").
 * The third-person action line is never used: rewriting it word by word
 * leaves slips like "You kneel and sets down" or "You draw his blade".
 */
export function captionOf(entry: Pick<RawLogEntry, 'content' | 'imageMeta'>, playerNames: readonly string[] = []): string {
  const written = entry.imageMeta?.caption?.trim();

  if (written) return firstSentences(written, 1, CAPTION_LENGTH);

  const opening = firstSentences(entry.content.replace(/\*+/g, '').replace(/\s+/g, ' ').trim(), 1, CAPTION_LENGTH);

  // Only a reply that names the player needs the swap; the narrator normally writes "you".
  return secondPerson(opening, playerNames);
}

export function scrapbookPhotos(db: AppDatabase): ScrapbookPhoto[] {
  const names = playerDisplayNames(db);

  return db.rawLog
    .filter((entry) => entry.role === 'assistant' && typeof entry.image === 'string' && entry.image.length > 0)
    .map((entry) => ({
      logId: entry.id,
      image: entry.image as string,
      date: entry.inStoryDate,
      chapter: entry.chapter,
      caption: captionOf(entry, names),
      place: entry.imageMeta?.location ?? null,
      age: playerAgeAt(db, entry.inStoryDate),
    }))
    .sort((a, b) => dateSortValue(a.date) - dateSortValue(b.date));
}

function chapterTitle(db: AppDatabase, chapter: number): string | null {
  const done = db.state.chapters?.find((item) => item.chapter === chapter);

  if (done?.title) return done.title;
  if (chapter === db.state.chapter) return db.state.chapterTitle ?? null;

  return null;
}

/** The scrapbook: chapters in story order, photos oldest first. */
export function scrapbook(db: AppDatabase): ScrapbookChapter[] {
  const chapters: ScrapbookChapter[] = [];

  for (const photo of scrapbookPhotos(db)) {
    let chapter = chapters[chapters.length - 1];

    if (!chapter || chapter.chapter !== photo.chapter) {
      chapter = { chapter: photo.chapter, title: chapterTitle(db, photo.chapter), photos: [] };
      chapters.push(chapter);
    }

    chapter.photos.push(photo);
  }

  return chapters;
}
