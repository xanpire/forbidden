# Tests waiting for session 3

These test files were written against the old Naruto seed and import modules
that session 2 deleted (canon data, jutsu, bingo books, the old map). They are
renamed from `*.test.ts` so `bun test` skips them. Session 3 rewrites each one
against `lib/rpg/testWorld.ts` and moves it back to `scripts/<name>.test.ts`.
