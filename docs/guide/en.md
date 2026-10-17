# BiNote Guide

How to use **BiNote**, an MML score editor for Mabinogi Mobile. This guide is written for 1.0 Beta.

Game limits in this guide were measured on the Korean server, and some translations of game terms are provisional.

> An unofficial fan-made tool, not affiliated with Nexon or Mabinogi Mobile. Rights to game names, instrument names and sounds belong to Nexon.

## Contents

1. [Getting started](#1-getting-started)
2. [Game rules to know first](#2-game-rules-to-know-first)
3. [A tour of the screen](#3-a-tour-of-the-screen)
4. [Entering notes](#4-entering-notes)
5. [Editing notes](#5-editing-notes)
6. [Tempo, meter and markers](#6-tempo-meter-and-markers)
7. [Shaping volume (v)](#7-shaping-volume-v)
8. [Transcribing from the original or a video](#8-transcribing-from-the-original-or-a-video)
9. [Put in game](#9-put-in-game)
10. [Importing MIDI](#10-importing-midi)
11. [Saving and file formats](#11-saving-and-file-formats)
12. [Settings](#12-settings)
13. [Shortcuts](#13-shortcuts)
14. [Using an iPad or phone](#14-using-an-ipad-or-phone)
15. [Frequently asked questions](#15-frequently-asked-questions)
16. [Reporting problems and translations](#16-reporting-problems-and-translations)

---

## 1. Getting started

### Opening BiNote

Open the BiNote site in a web browser (Chrome, Edge or Safari). Nothing needs to be installed. On your first visit the browser downloads all app files, and after that BiNote opens without an internet connection. If you plan to use it offline, turn off the network once and check that it still opens. This guide is an online document, so it does not open offline.

If you use BiNote often, we recommend **adding it to your home screen (installing the app)**.

- Chrome or Edge on PC: the install icon at the right of the address bar
- Safari on iPad or iPhone: Share → Add to Home Screen
- Chrome on Android: ⋮ → Add to Home screen (Install app)

Whether the installed app and a browser tab share storage (sound packs, autosaves) depends on the device.

- PC and Android: they share it if they use the same browser, the same profile and the same address.
- iPhone and iPad: a home screen app has storage separate from Safari tabs. You need to add your sound packs again in the home screen app, and songs autosaved in a tab do not show up there.

To move your work to another device or browser, save it as a project (.mme) file and open that file.

### Start screen

When no song is open, the start screen shows three buttons.

| Button | What it does |
|---|---|
| New score | Starts with one piano score and one empty track (t120, 4/4) |
| Open score | Opens 3MLE (.mml), MabiIcco (.mmi), MIDI (.mid) or BiNote project (.mme) files |
| Paste MML@ | Opens score text in the in-game `MML@…;` format. Pressing Ctrl+V outside the editors also opens it |

If you were editing a song, a **Recent work** list appears below the buttons. You can bring a song back from here even after reloading or closing the tab.

### Sound packs

**You can edit without a sound pack.** To hear sound, add a sound pack (.dls, .sf2, .sf3). Mabinogi sound packs are Nexon assets and are not included in BiNote, so you need to get one separately.

- To add one: Settings (⚙) → Sound packs → Add sound pack, or click "No sound pack" in the status bar
- If you add several, **packs higher in the list are used first**. The pack you add first goes on top. Use the ▲▼ buttons next to a pack to change the order; the order is kept the next time you open the app.
- Instruments written only as a MabiIcco number (e.g. `#40.3`) are looked up only in the pack matching their `.2`/`.3` suffix (recognised by file name), regardless of order. Because the same number can be a different instrument in another pack, they are reported as not found instead of borrowing another pack's number. Named instruments such as the harp (`24.2`) use the matching pack first and fall back to the same instrument in another pack.
- Added packs are stored in this browser and loaded automatically next time. Files are never sent to a server.
- If a pack lacks an instrument, BiNote shows "Instruments not found in any sound pack".

### Quick start: your first score

1. On the start screen, click **New score**.
2. Click an empty cell in the piano roll to add a note. To write MML instead, type the example below into the MML editor in the track panel.
   ```
   t120o4l4v8cdefgab>c
   ```
3. If you added a sound pack, listen with **Play** (Space). Without a sound pack you can still edit and copy for the game.
4. Save a `.mme` file with **File → Save project** (Ctrl+S). Saving as 3MLE (.mml) is Ctrl+Alt+S.
5. In **File → Put in game…**, check errors, warnings and character counts.
6. Click the **Copy … MML@** button of the score you want, and paste it into an empty score in the game. If there are several scores, copy them one at a time.

The example above is MML for the track editor. When opening with **Paste MML@**, use the full format, such as `MML@t120o4l4v8cdefgab>c;`.

---

## 2. Game rules to know first

BiNote checks and exports scores to fit the limits of Mabinogi Mobile. The terms below mean the same thing on screen and in this guide.

| Term | Meaning |
|---|---|
| **Score** | What you paste into the game at once. One `MML@track1,track2,…;` |
| **Track** | One line in a score (melody, chord 1–5). A track plays one note at a time |
| **Player** | Someone who plays one instrument within a score. One score can have several players |
| **Score book** | Splitting a long song into several scores that play one after another |

Game limits:

- **Up to 6 tracks** per score. The first player has 1–3 tracks, and each later player has 1 track (3+1+1+1, 2+1+1+1+1 and 1×6 work; 2+2+2 and 3+3 do not)
- **Music box and gramophone** take 3 tracks per score. For 6-note chords, split into two 3-track scores and play them at the same time (each paste holds all 6 tracks in a different order: the game plays only the first 3, but takes length and tempo from all 6, so the boxes stay in sync). Tracks with their own instrument can't stay in a music box score and move to a new score
- **2400 characters** per track
- **Tempo is read separately for each score.** That is why BiNote writes the tempo into every score when you put a song in the game
- Tempo t32–t255, note length 1–64 (up to one dot), volume v0–v15 (v0 is silent)
- Each instrument has a fixed range of pitches it can sound. Notes outside it raise no error; they are moved by octaves into the range. This guide calls this **range folding**
- In a score book, there is a gap of about 1 second when moving to the next score

These limits are BiNote's current check values, measured on the Korean server (as of October 2026). Switching the display language to Japanese or Chinese does not change them, and they do not describe the limits of other servers. Some items, such as what happens when tracks of the same player overlap on the same note, have not been fully measured yet.

---

## 3. A tour of the screen

```
┌ Top bar: File · Edit · Song · View · Undo · Play · Volume · MIDI keys · Panel · Help (?) · Settings ┐
├ Toolbar: Piano roll/Tab · Tools · Grid · New note · Input v · Layer · Zoom · ⋯                 ┤
├ Work area: Piano roll (or Tab)  │  Track panel (structure list + MML editor)                  ┤
└ Status bar: Selected track · Characters · Checks · Sound packs · Help                           ┘
```

### Menus

| Menu | Contents |
|---|---|
| File | New score, Open score, Paste MML@, Restore recent work, saving (3MLE, project, MabiIcco, MIDI, WAV), Put in game, Add sound pack |
| Edit | Undo and Redo, Select all, delete, Cut, Copy, paste, Length ×2 and ½, Transpose, Split / merge tracks |
| Song | Change time signature, Tap tempo, Clear tempos, Copy tempo to every score, Add track and Add score, Distribute chords, Shrink MML, Split into score books |
| View | Piano roll/Tab, Panel below/beside, Side by side, Two editors, Vertical roll, Events, Note list, Light keys while playing, Mark stop position in MML, Track colors, MML keypad, Shortcuts |

### Track panel

- **Structure list**: shows scores, then the tracks in each. Each track has M (mute) and S (solo), a character-count bar, a lock and a ⋯ menu (Move up, Move down, Duplicate track, Move to another score, Move to a new score / Copy to a new score, Hide in roll). A track with MML checks shows a red dot and the count next to its name.
- Double-click a name to rename it (Enter to confirm, Esc to cancel).
- Drag the handle on the left to move a track to another score. On touch, long-press a track to open its menu.
- **MML editor**: edits the MML text of the selected track. Syntax errors and game limit problems are underlined; hover over an underline to see the details.
- You can put the panel **below** the roll (3MLE style, for keyboard use) or **beside** it (for mouse and touch). Drag the border to resize it.
- With **Two editors** on, the lower editor opens another track (Alt+click it in the list).

### Status bar

- Selected track, characters / limit
- **Checks N**: check results for the whole song. Click to expand, then use "Go there" to jump to a problem.
- Number of sound packs and instruments
- **Help**: a summary of piano roll and tab controls

---

## 4. Entering notes

Changes made in the piano roll, the MML editor and the tab all apply to the same song.

### Piano roll

| Action | Mouse | Touch / pen |
|---|---|---|
| Add a note | Click an empty cell (drag to make it longer) | Tap an empty cell |
| Move | Drag the note | Drag the note |
| Change length | Drag the end of the note | Drag the end of the note |
| Delete | Right-click | Eraser tool |
| Select several notes | Ctrl+click, or Ctrl+drag on empty space | Drag with the Select tool |
| Place the play cursor | Shift+click | — |
| Loop range | Shift+drag | — |
| Tie to the next note with & | Alt+click | — |

- **New note** length: "Grid" uses one grid cell; pick a length to add notes of that length regardless of the grid (triplets included)
- **Tools**: Draw (default) · Select (only selects by tapping or dragging; unlock the padlock next to it to drag selected notes) · Eraser · Scissors (cuts a note where you tap)
- **Layer**: draws only the Selected track, the same Score, or All tracks in the roll. Notes of other tracks appear faded; with "Click other tracks' notes to switch" on, clicking one switches to that track.
- Clicking a note highlights its place in the MML text; double-clicking lets you type there right away.
- Moving around: wheel (time) · Shift+wheel (pitch) · Ctrl+wheel (zoom time) · Ctrl+Shift+wheel (key height) · Fit all button
- **Vertical roll**: for tracing falling-note videos Set Settings → Display → **Roll during playback** to **Scroll continuously** and notes keep falling onto the keyboard while playing (for recording vertical videos).

### MML editor

Write MML directly. Your edits show up in the piano roll and in playback. If there is a syntax error, check the underline and Checks in the status bar.

| Command | Meaning |
|---|---|
| `c d e f g a b` | Notes (`+` or `#` sharp, `-` flat), followed by a length (`c8`, `e4.`) |
| `r` | Rest |
| `n<number>` | Note by number |
| `o<number>` `<` `>` | Set octave, octave down, octave up |
| `l<number>` | Default length |
| `v<number>` | Volume 0–15 |
| `t<number>` | Tempo |
| `&` | Tie to the next note (same pitch: held; different pitch: slide) |

- When the same pitch is tied with `&`, the game ignores any v after the &.
- When different pitches are tied with `&`, the note is not struck again; only the pitch changes at the join (it is not a gliding sound). BiNote calls this a slide. Removing the `&` makes them separate notes and changes how it plays.
- On iPad, turn on **MML keypad** (View menu) to type with an MML keypad instead of the on-screen keyboard.

### Tab (guitar tablature)

Switch with the Piano roll/Tab button (Alt+T). The tab gathers the tracks of the selected score and picks strings and frets automatically.

- Click on a string to place the cursor, then **type the fret number** (two digits in a row), move with the arrow keys, delete with Delete
- `+` / `-`: double / halve the cursor note (also sets the new-note length). On the fret pad, changing **New note** also changes the note at the cursor. Lengthening stops at the next note in the same track
- Typing a fret over an existing note changes only its pitch, not its length
- `L`: tie to the note right after with & · `(5)` held · `5/7` slide. If nothing follows, adds the same pitch for the new-note length, tied (an eighth + L rings as a quarter)
- Chord notes at the same spot go into free tracks of the same score
- You can choose a tuning (Standard, Drop D, DADGAD, Baritone and more) and a capo
- With several tracks, each number is tinted with its track color and numbers from other tracks are dimmed (turn off in Settings → Display → Track colors on tab numbers)
- On touch, use the **Fret pad**. Pick the length of new notes in **New note** at the top of the pad (Grid / l4 / l8 / triplets…, the same setting as New note in the toolbar). With "Advance after entering" on, the cursor moves on by that length

### MIDI keys

Turn on the keyboard icon in the top bar and connect a MIDI keyboard to use **step input**, one note at a time. Notes go at the play cursor (or the end of the selected track if there is none) with the **New note** length, and the input position moves on by that length. The time you hold a key is not recorded as the length.

- For keys pressed together, the highest note goes into the current track and the rest go, from high to low, into the following tracks of the same score. Notes beyond the remaining tracks are not entered, so check the number of tracks before entering chords.
- The first time you turn on MIDI keys, BiNote asks once whether to use key velocity as v. You can change it later in Settings → Playback → "Velocity → v".

> We recommend Chrome or Edge on PC. MIDI keyboards do not work in Safari (Mac and iPad) or in other browsers on iPad.

---

## 5. Editing notes

### Changing selected notes

| Task | How |
|---|---|
| Move one step | Arrow keys |
| Octave up / down | Shift+↑ / Shift+↓ |
| Volume up / down | Alt+↑ / Alt+↓, Alt+wheel |
| Set volume directly | Alt+digit (6–9 → v6–9, 0 → v10, 1–5 → v11–15, Alt+\` → v0, Alt+Shift+0–5 → v0–5) |
| Length ×2 / ½ | Ctrl+] / Ctrl+[ |
| Exact length | Type an MML length (8, 8., 16..) or a fraction into the selected-note box in the status bar and press Enter. Fractions are in whole notes, so `1/7` is one seventh of a whole note. Any fraction can be used while editing, but when putting the song in the game it is written as a combination of lengths 1–64 (up to one dot), and you get a warning if it cannot be written exactly |
| Tie / untie | Alt+L |
| Split | Scissors tool, or Alt+S at the play cursor |
| Glue | Alt+G (makes touching notes of the same pitch one note for editing; different from tying with &) |
| Copy / cut / paste | Ctrl+C / Ctrl+X / Ctrl+V (pastes at the play cursor) |

### Whole-song editing

- **Transpose** (Alt+P): moves the selected notes, this track, this score or the whole song by semitones or octaves. It tells you in advance how many notes will be range-folded in the game.
- **Split / merge tracks**: move selected notes to another track (or a new track), merge a score's tracks into one, or re-split them by pitch. Overlapping notes are not moved and stay where they are.
- **Insert bar / Delete bar**: inserts or deletes one bar at the play cursor (all tracks and tempos move together).
- **Track lock**: click the lock to stop a track from being edited in the roll, tab or editor. Selecting and copying still work. If a locked track is in the range of a transpose, it is moved too after you confirm. The padlock next to the Select tool in the toolbar (for dragging selected notes) is a different feature from the track lock.

### Undo

Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z). Whole-song commands are undone in one step.

---

## 6. Tempo, meter and markers

### Event rows

Two rows above the roll show tempo, meter and markers. They are on from the start; turn them off or on with View → **Events** (your choice is remembered).

- Double-click an empty spot (long-press on touch) or right-click a label to add or edit.
- Drag a label to move it. Over a tempo label, the wheel changes it by ±1 (Shift ±10), and Del deletes it.
- Keyboard: **Alt+B** adds a tempo at the cursor, **Alt+M** a marker

### Time signature

Song → Change time signature. The change starts from the bar containing the play cursor (or from the start of the song if there is no cursor). 6/8, 9/8 and 12/8 show three eighth notes as one beat.

### Tap tempo

Song → Tap tempo. Play the original (or a video) and press the **T** key or [Tap] **on the first beat of each bar**; the tempos are set when playback stops.

- If the first beat is hard to hear, switch to **Per beat** and tap along as if counting beats.
- **Smooth jitter** in the tap tempo bar (Light 30ms · Normal 60ms · Strong 100ms): taps that drift within the chosen range are treated as hand jitter and merged into one tempo. This also reduces the number of tempo commands and MML characters.

### Cleaning up tempos

- **Clear all tempos**: keeps only the tempo at the start of the song. With a loop range set, only the tempos inside it are cleared.
- **Copy tempo to every score**: writes the song tempo into the MML text of scores that lack it. (Put in game and Split into score books add tempo to every score even without this.)
- Tempos outside the game range (t32–t255) can be used while editing; Put in game tells you how to convert them (see section 9).

---

## 7. Shaping volume (v)

### Input v

**Input v** in the toolbar is the volume for new notes. "Inherit" follows the v of the previous note. When notes are selected, it becomes **Selected v** and changes them all at once.

### Volume lane

The **Volume (v)** strip at the bottom of the piano roll is the volume lane. If it is hidden, open it with the **Volume ▲** button in the corner by the keyboard strip. Each bar is one group of notes tied with `&`, and the numbers on the right are the v scale.

- **Brush**: sets the v of each bar you drag over to that height.
- **Line** (or Shift+drag): changes v along a straight line from where you press to where you release.
- If notes are selected, only those notes change.
- **On several tracks at once**: Ctrl+click tracks in the track list to add them. The melody track gets the drawn value as is, and the other tracks get the offsets set for the top, middle and bottom positions. Without a melody mark, the first track of the score is the melody.
- Make the lane thin, large or hidden. Drag the handle above the lane to any height (dragging from the thin strip works too), and double-click it to switch between thin and large. You can also pick the height in Settings → Display → **Volume lane**. A taller lane makes drawing with a pen easier.

---

## 8. Transcribing from the original or a video

### Original

Toolbar ⋯ → **Original…**: pick an audio or video file to play along with the score. The file stays on this device and is never sent to a server.

- **Offset (ms)**: + if the original is later. Lines up the start.
- **Original volume**: the volume of the original
- **Waveform**: shows the original's waveform under the bar-number row of the roll, aligned to song time.
  - Click the waveform to jump there.
  - **Drag a bar line** on the waveform onto a beat of the original to change the tempo so that bar lands there.
  - Drag an empty part of the waveform to slide the original back and forth, changing the offset.

### Background video

Toolbar ⋯ → **Background video…** (in the piano roll). Put a falling-note video (such as a piano performance video) behind the piano roll and enter notes while watching it.

- **Align to keys**: set the video's leftmost and rightmost keys and the keyboard line so they line up with the roll's keys. Turn on **Drag to align** to adjust by dragging on the roll.
- **Fit roll**: moves and zooms the roll to the video's key range.
- Adjust Opacity, Offset (s), Time stretch and Video sound.
- **Play video**: plays only the video, without the song; the roll follows it.

### Useful together

- **Vertical roll**: matches the direction of falling-note videos. Choose Settings → Display → Roll during playback → **Scroll continuously** to get falling notes even without a video.
- **Light keys while playing** (on by default): shows the notes being played on the keys. Turn it off in the View menu or Settings → Playback.
- Settings → Playback → **Display sync**: + if the playhead runs ahead of the sound, − if it lags. iPad and Bluetooth earphones may need another 100–300ms.

---

## 9. Put in game

Check the output and copy it in File → **Put in game…**.

### Put in game window

For each score, it shows characters, tracks, folded notes, errors and warnings, with a **Copy … MML@** button for each score.

1. Click the copy button. When the button changes to "Copied", the text is copied. If it does not change, check the browser's clipboard permission.
2. Open an empty score in the game and paste. You can paste **only one score at a time**.
3. Copy and paste the remaining scores one by one.

- Tempo is written into every score.
- The output MML is rewritten to use fewer characters. The text in the editor is not changed.
- If a tempo change falls in the middle of a note on every track of a score, it is written at the next note boundary so no note is lost, and you are told.

### If the tempo is outside the game range

If it is faster than t255, BiNote shows how to shorten the note lengths in that section and lower the tempo; if it is slower than t32, how to lengthen them and raise the tempo. The speed stays the same.

### If there are too many characters

Try these in order.

1. **Distribute chords**: moves notes from tracks over the limit into free tracks of the same player. They stay on the same instrument, so the notes are kept as they are. (When the score has several tracks of the same instrument.)
2. **Shrink MML**: rewrites the MML of every track shorter while keeping each note's pitch, start and length. Your own spaces, line breaks and comments are lost. If shrinking would drop notes, nothing is changed and you are told.
3. **Split into score books**: cuts all tracks at the same point into several books.
   - **Distribute chords before splitting** (on by default): before splitting, moves notes between tracks of the same instrument to even out channel lengths. If every channel then fits the limit, no split is needed; if it saves books, the split uses the moved result. The song you are editing stays as it is; "Apply to song" moves the notes in the song too (undo with Ctrl+Z). When off, only the book split runs, and a "N → M books" hint appears if moving notes would help.
   - **Thorough split** (off by default): at each book end, follows several more cut points near the limit to find a split with fewer books. It takes longer, so the stage and a progress bar show at the bottom while it runs. Short songs always get the exact fewest books even without this option.
   - Places where everyone rests are chosen first.
   - Octave, volume and tempo are written again at the start of each book.
   - Each book ends early by the delay before the next one starts (about 1 second) to keep the beat. Notes in that stretch can be shortened or dropped. Check "notes cut at the end" and the length warnings in the result, and listen around the book boundaries before using it.

For Distribute chords and Shrink MML, check the character counts before and after in the **preview**, then apply. Applied changes can be undone with Ctrl+Z. Split into score books does not change the original song; it only makes the output for each book. Use the per-score copy buttons in each book.

### Song checks

See problems in the whole song in **Checks N** in the status bar.

- Over the character limit; tempo, length or volume out of range
- Notes outside the instrument's range that get **range-folded** (shown gray in the roll)
- **Long notes whose end is silent** because the game sample runs out (game sounds play once without looping)
- Too many tracks for one player; tracks of the same player overlapping on the same note
- Two notes tied with & that cross a timbre boundary

---

## 10. Importing MIDI

Choosing a .mid file with Open score opens the **Import MIDI** window.

1. For each **MIDI part**, look at the note count, range and polyphony, and choose which **Player** gets it. You can also Skip it or send it to Percussion. If no instrument matches, a close one is picked.
2. Set the number of **Chords** for each player. The chord total for the whole song is shown at the top.
3. Choose the order in which notes are dropped where they overflow.
   - Middle first (keep outer, default) · Bottom first · Top first · Soft notes first · Short notes first
   - Hand to drop first (Both hands evenly · Right-hand chords first · Left-hand chords first), Protect melody
4. **Grid** (Auto or manual) and **Keep triplets**
5. **Fill empty channels**: puts chord notes dropped by compression back into resting channels. If this goes over the character limit, the added notes are removed first.
6. Check the summary at the bottom (dropped notes, notes put back, longest channel's character count) and click **Import**.

Importing MIDI does not copy the original exactly. Notes beyond the chord count are dropped, and note lengths are adjusted to the grid. Listen after importing and fix what needs fixing.

---

## 11. Saving and file formats

| Format | Menu | When |
|---|---|---|
| **Project .mme** | Save project (Ctrl+S) | **Recommended for keeping your work and moving it to another device.** Keeps fractional positions, track structure and editor state (older .mmlce files also open) |
| 3MLE .mml | Save as 3MLE (Ctrl+Alt+S) | To open in 3MLE. The default is CP949, and characters it lacks become ?, so save as UTF-8 if needed |
| MabiIcco .mmi | Save as MabiIcco (Ctrl+Shift+S) | To open in MabiIcco. You are told about notes that do not fit its grid (96 per quarter note) |
| MIDI .mid | Save as MIDI | For DAWs and similar. Instruments become GM programs, and bass drum and cymbal go on the drum channel. Notes of different pitches tied with `&` are saved as separate notes in MIDI |
| WAV | Save as WAV | Renders the whole song with the current sound packs into an audio file (mute and solo as heard). Needs a sound pack |
| MML@ text | Put in game | For pasting into the game |

### Where files are saved

Set this in Settings → **Saving**.

- Chrome and Edge on a PC: the default is **Choose folder and name each time**. As when opening a file, a save dialog opens so you pick the folder and file name, and the next save starts in the folder you used last.
- Chrome and Edge on a PC: pick **Save straight to a set folder** and choose a folder, and every saved file goes there without asking. A file with the same name is overwritten. After the browser restarts, the first save may ask you to allow the folder again. Pick **Downloads folder** to save through browser downloads.
- iPad and iPhone: with **Save through the share sheet** (on by default), saving opens the share sheet. Use "Save to Files" to pick a folder, or send the file straight to an app such as Google Drive.
- Other browsers (Firefox and so on) save to the Downloads folder.

What a project (.mme) includes and does not include:

- Included: the scores, editor state, and the **file names and alignment values** (offset, key positions and so on) of the original and background video
- Not included: sound packs, the original audio or video **files themselves**, app settings such as theme and language

To continue on another device, prepare the sound packs and the original and video files separately. If you pick an original or video with the same name again, the saved alignment values are loaded.

### Autosave

The song you are editing is kept in this browser automatically (latest 10). After a reload or closing the tab, open it from the start screen or from File → **Restore recent work**.

> Autosave is **for temporary recovery only**. It can disappear if you clear browser data or space runs low. Always **save songs you want to keep as .mme**. On iPad, we recommend keeping them in the Files app.

### New versions

When a new version is out, a "A new version is ready" bar appears. Click **Reload** and BiNote waits for the autosave of your current song to finish, then switches to the new version. If the autosave fails, it does not switch and tells you; in that case save as a project (.mme) and click again. For important work, saving as .mme before clicking is safer. You can also close the notice and keep working.

The app checks for a new version each time it opens, and if it stays open for a long time it checks again at most once an hour when you come back to the window. To check right away, use **?** → **Check for updates** in the top bar.

---

## 12. Settings

⚙ in the top bar.

| Section | Items |
|---|---|
| Sound packs | Add and remove, check and change priority (list order), storage status |
| Playback | Master volume, Light keys while playing, MIDI keys Velocity → v, Display sync, Instrument volumes |
| Display | Theme (Follow system · Light · Dark), Accent color, Note look (Rounded corners · Border · Shade by v · Note names when zoomed in), Track colors (By position in score · Hue per score · Saved in file), MML editor text and text size, Roll during playback (Turn pages · Scroll continuously) |
| Saving | Choose each time, a set folder or Downloads (Chrome and Edge on a PC), Save through the share sheet (iPad and iPhone) |
| Language | Pick the interface language. At first BiNote follows your browser language (English if it is not Korean, English, Japanese, Traditional or Simplified Chinese) and remembers your choice |
| Shortcuts | Open shortcut settings (Key set: BiNote default / MabiIcco compatible, change keys) |

At the bottom are the version info and links to the guide and **About BiNote**.

The **?** menu next to Settings (⚙) in the top bar has Guide, Shortcuts, Check for updates and About BiNote. The **About BiNote** window shows the version, checks for updates and links to the source code, licenses and problem reports. You can also open this guide from Help in the status bar.

---

## 13. Shortcuts

These are BiNote's default keys for the piano roll and elsewhere. You can change them in Settings → Shortcuts (Ctrl+/) or switch to the **MabiIcco compatible** key set. On Mac you can use Cmd instead of Ctrl.

While typing in the MML editor, only Ctrl/Alt combinations and F keys work as shortcuts. Of those, Ctrl+A, C, X, V and Length ×2 / ½ are used for text editing, and shortcuts that change notes, tracks or events (Alt+S, G, B, M, L, P, Alt+↑↓ and so on) do not run. Saving, playback and undo still work.

| Category | Key | What it does |
|---|---|---|
| File | Ctrl+O | Open file |
| | Ctrl+S | Save project |
| | Ctrl+Shift+S | Save as MabiIcco |
| | Ctrl+Alt+S | Save as 3MLE |
| Playback | Space | Play / pause |
| | F5 | Play |
| | Esc | Stop |
| Edit | Ctrl+Z / Ctrl+Y | Undo / Redo |
| | Ctrl+A | Select all notes in the current track |
| | Ctrl+C / X / V | Copy / cut / paste |
| | Delete, Backspace | Delete selected notes |
| | Ctrl+] / Ctrl+[ | Length ×2 / ½ |
| | Alt+P | Transpose |
| Note | Shift+↑ / ↓ | Octave up / down |
| | Alt+↑ / ↓ | Volume up / down |
| | Alt+L | Tie or untie to the next note with & |
| | Alt+S | Split at the play cursor |
| | Alt+G | Glue touching notes of the same pitch |
| Events | Alt+B | Add or edit a tempo |
| | Alt+M | Add a marker |
| | T | Tap tempo (while the tap tempo bar is open) |
| Track | PageUp / PageDown | Previous / next track |
| | Alt+Shift+↑ / ↓ | Move track up / down |
| Grid | 1 2 3 4 5 | 1/4 · 1/8 · 1/16 · 1/32 · 1/64 |
| | 6 7 8 | Triplets 1/12 · 1/24 · 1/48 |
| View | Alt+T | Piano roll / tab |
| | Alt+O | Horizontal / vertical roll |
| | Ctrl+/ | Shortcut settings |

---

## 14. Using an iPad or phone

- **Panel beside** is the default for touch. In portrait on iPad, the screen is split top and bottom.
- To select notes, the **Select tool** is safest (it never adds or moves notes). To delete, use the **Eraser**.
- **Long-press** a track to open its menu (Move up, Move down, duplicate, move, Open in lower editor).
- **Long-press** an empty spot in the event rows to add a tempo or marker.
- Zoom and scroll the roll with two fingers.
- Turn on **MML keypad** (View menu) to type MML characters without the on-screen keyboard.
- Enter tab with the **Fret pad**.
- Safari and Chrome on iPad use the same engine (WebKit), so stored data may be cleared. **Save .mme files to the Files app.**
- On iPad and iPhone, home screen apps and Safari tabs have separate storage, so you need to add sound packs in each, and their autosaves do not show up in the other.
- MIDI keyboards cannot be used on iPad.

---

## 15. Frequently asked questions

**There is no sound.**
Check the status bar to see whether a sound pack is added. If "Instruments not found in any sound pack" appears, add a pack that has that instrument. If another pack's sound is used first, change the order with ▲▼ in the sound pack list in Settings. On iPhone and iPad, also check the silent switch.

**I get an error when I paste into the game.**
Check the error and warning counts in the Put in game window, then find and fix the spots with Checks in the status bar. Also make sure you pasted only one score at a time.

**The preview sounds different from the game.**
The preview plays with the sounds of the sound packs you added and BiNote's own playback. Depending on the pack and how instruments are mapped, it can sound different from the game. Check range folding (gray notes) and long notes whose sample runs out in the check results.

**The character count keeps going over.**
Try Distribute chords → Shrink MML → Split into score books, in that order (section 9).

**My work disappeared.**
Look in File → Restore recent work. On iPad and iPhone, autosaves of home screen apps and Safari tabs are not visible to each other. If the site address differs (for example a test address and the official address), storage differs too, and autosaves do not carry over. Save songs you want to keep as .mme.

**Characters became ? after saving as 3MLE.**
Those characters are not in 3MLE's default encoding (CP949). Save as UTF-8 or change the name.

**I get an error when opening in MabiIcco.**
If some notes do not fit the MabiIcco grid (96 per quarter note), BiNote tells you when saving. Adjust those notes' lengths to fit the grid.

---

## 16. Reporting problems and translations

Use **Report a problem or translation** at the bottom of Settings, or open an [issue](https://github.com/EarlGreyPie/BiNote/issues/new/choose) in the repository.

- It helps to include the version info (at the bottom of Settings: "BiNote v… · commit …") and your device and browser.
- If a song is needed, MML@ text or a short example is enough. **Do not attach sound pack files.**
- If a translation is wrong or awkward, choose "translation report". Telling us the official in-game term is especially helpful.
