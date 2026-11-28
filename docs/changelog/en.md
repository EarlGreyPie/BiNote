# Changelog

What changed in each BiNote version, from 1.0.0 on. Earlier versions (beta and rc) are written only in Korean, in [CHANGELOG.md](../../CHANGELOG.md). A new version applies when you reopen the app. You can see your version at the bottom of Settings or under ? → About BiNote.

## 1.0.0 (2026-11-28)

This is the first official release of BiNote. After checking 1.0.0-rc.4 on a real iPad and in the game, we fixed the problems found and are releasing it as 1.0.0. 1.0.0-rc.5 was not released separately; it is part of this version. From this version on, the changelog is also written in English, Japanese and Chinese (Traditional and Simplified).

### Changes
- **What's new is shown in your screen language.** The new-version notice and ? → What's new in this version show the changelog written in English, Japanese or Chinese when the app is in that language. Versions before 1.0.0 (beta and rc) are still only in Korean. The full changelog link in About BiNote also opens the file for your screen language.
- **In Export MML, you can drag a line in the Paste order list straight to the slot you want.** Before, ▲ ▼ moved a track only one slot at a time, so moving the bottom track to the top took many presses. Now grab ⠿ at the start of a line and drag it up or down: the slots change while you drag, and where you drop it becomes that track's slot.
  - It works with a mouse, a finger or a pen. ▲ ▼ still work too.
  - Dragging makes it a **Custom order**; when it matches the song order again, it goes back to song order.
- **We rewrote the repository front page (README) and added English and Japanese versions.** The notes on soundpacks, where your songs are stored and compatibility now come first for new users, and we added notes on the beta page, where new features are tested first, and its own beta bug report form.

### Fixes
- **Fixed again: on iPad, after sleep or screen lock, sound played later than the playhead (drifted).** The playhead is drawn late by the output latency the browser reports. After sleep, the real latency could grow while the value the iPad reports stayed the same. So even after recreating the audio or matching the synth clock, the sound came after the playhead.
  - BiNote now measures the latency every second from the real output time the browser gives (the time of the sound now coming out of the speaker). When it is clearly larger (over 20 ms) than the reported value, the playhead is delayed by the measured value. Jumps right after waking are ignored; the middle value of the last five measurements is used.
  - When the audio is recreated after sleep, the old audio is closed first. This is closer to quitting and reopening the app.
  - Settings → Playback → **Audio status** → **Measure** shows the latency used for the playhead (`used for playhead`) and keeps a record when the measured latency changes a lot.
  - Songs and exported MML stay the same.
- **Fixed: on iPad and iPhone, Open score, Add sound pack and Import MusicXML also offered "Photo Library" and "Take Photo or Video".** Now the Files app opens directly without these items, and you can pick .mme, .mml, .mmi, .mid, .dls and the other files as before.
  - Opening an original recording or background video still lets you use videos from the photo library.
  - The open dialogs on Android and PC do not change.
- **The Distribute chords tab (Fit the character limit → Distribute chords) now uses the in-game character count for the counts, the overflow mark (⚠), Pick as much as needed and the before/after table.** The in-game character count is the length of the shortest text written when you paste into the game, the same number as the bars at the top of the window. The source text also counts comments, line breaks and repeated l and v, so it can be longer.
  - Before, a track whose source text was long but whose in-game count was within the limit was shown as over the limit, and **Pick as much as needed** found nothing to pick and only said tracks were still over. Now such a track says it already fits in the game, and the automatic pick button is off.
  - The before/after table also uses the in-game count, so tracks you did not move no longer look much shorter just because their text was rewritten.
  - When automatic picking cannot find more spans (the receiving tracks are close to the limit too), it tells you why and suggests adding an empty track or splitting into score books.
- **The Merge chords tab also shows track character counts and the before/after table in in-game characters.** What it does is the same as before.
