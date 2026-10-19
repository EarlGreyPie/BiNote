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
- **You can pick the pack each track plays with.** In the track editor header, the pack picker next to the instrument picker (shown when two or more packs are loaded) makes that track (or its score, if the track has no own instrument) play with the chosen pack. The default is **Auto (top pack first)**. If the chosen pack isn't loaded, the top pack is used instead and the picker shows "(missing)" after the pack name. The song keeps the chosen pack name, so adding that pack again plays it with that pack. Picking a `.2`/`.3` pack also puts that pack number into the instrument number when saving for MabiIcco.
- Instruments whose number carries a `.2`/`.3` pack suffix show it after the name, like **Harp(24.2)**, in the track editor's instrument picker, the score chips in the track strip, and the not-found instrument notice. Base instruments show the name only.
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
- Tempo t32–t255, note length 1–64 (up to one dot; the dot works even on the 64th, so `64.` = 3/128 is allowed), volume v0–v15 (v0 is silent)
- Each instrument has a fixed range of pitches it can sound. Notes outside it raise no error; they are moved by octaves into the range. This guide calls this **range folding**
- In a score book, there is a gap of about 1 second when moving to the next score

These limits are BiNote's current check values, measured on the Korean server (as of October 2026). Switching the display language to Japanese or Chinese does not change them, and they do not describe the limits of other servers. Some items, such as what happens when tracks of the same player overlap on the same note, have not been fully measured yet.

---

## 3. A tour of the screen

```
┌ Top bar: File · Edit · Song · View · Undo · Play · Volume · Help (?) · Settings ┐
├ Toolbar: Piano roll/Tab · Tools · Grid · New note · Input v · Horizontal|Vertical (panel) · Layer · Zoom · ⋯                 ┤
├ Work area: Piano roll (or Tab)  │  Track panel (structure list + MML editor)                  ┤
└ Status bar: Selected track · Characters · Checks · Sound packs · Help                           ┘
```

### Menus

| Menu | Contents |
|---|---|
| File | New score, Open score, Paste MML@, Restore recent work, saving (3MLE, project, MabiIcco, MIDI, WAV), Put in game, Add sound pack, Connect MIDI keyboard |
| Edit | Undo and Redo, Select all, delete, Cut, Copy, paste, Length ×2 and ½, Arpeggio, Slide, Grace notes, Transpose, Split / merge tracks |
| Song | Change time signature, Tap tempo, Clear tempos, Change all tempos, Copy tempo to every score, Add track and Add score, Distribute chords, Merge chords, Shrink MML, Split into score books |
| View | Piano roll/Tab, Panel below/beside, Side by side, Editors, Vertical roll, Events, Note list, Light keys while playing, Mark stop position in MML, Track colors, MML keypad, Tab fret pad, Shortcuts |

### Track panel

- **Structure list**: shows scores, then the tracks in each. Each track has M (mute) and S (solo), a character-count bar, a lock and a ⋯ menu (Move up, Move down, Duplicate track, Move to another score, Move to a new score / Copy to a new score, Hide in roll). A track with MML checks shows a red dot and the count next to its name.
- Double-click a name to rename it (Enter to confirm, Esc to cancel).
- Drag the handle on the left to move a track to another score. On touch, long-press a track to open its menu.
- **MML editor**: edits the MML text of the selected track. Syntax errors and game limit problems are underlined; hover over an underline to see the details.
- Move the panel with the **Horizontal | Vertical** buttons on the right of the toolbar (left of Layer). **Horizontal** puts it beside the roll (for mouse and touch), **Vertical** puts it below the roll (3MLE style, for keyboard use). This is the same as Panel below/beside in the View menu. Drag the border to resize it.
- View → **Editors** (1–4, maximum set in Settings → Display) stacks several MML editors in the track panel so you can see several tracks' text at once. The top one shows the selected track; a track you Alt+click in the list or track strip opens in the lower editor that was changed longest ago (with one editor, a second one is added). The same track never opens in two editors, and each lower editor closes with its ×.

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
- **Tuplets**: pick **Tuplet…** at the bottom of the new note length list and choose "N notes in the time of a note" (2–15 notes; whole, 1/2, 1/4, 1/8, 1/16, 1/32 and their dotted notes). One note is the base number × N: 5 in a quarter = l20, 7 in a quarter = l28, 2 in a dotted quarter = l8. The tuplet becomes the new note length, and **Also set the grid** (on by default) changes the grid too (1/20 for 5 in a quarter). The game accepts only l1–l64, so shorter notes such as 5 in a 16th (l80) cannot be picked (nothing is rounded). Your tuplet is remembered in this browser
- The grid list also gets the cell of your tuplet and a cell that fits the new note length. With 5 in a dotted quarter (l20.), 1/40 appears. Grids whose cell is shorter than 1/64 (such as 1/128) are not offered, because a note or rest of that length cannot be written for the game. To continue right after a 64., use the tab fret pad or MML text.
- An edit that would leave a note or rest whose length cannot be written exactly for the game (for example cutting a 5-in-a-quarter note on the 1/28 grid, which leaves a 1/70 piece) is not made, and the reason is shown. This applies not only to adding, cutting, pasting, resizing, moving, arpeggio, slide and grace notes, but also to song edits such as Delete bar, Split / merge tracks, Distribute chords and Merge chords. Only MML text you type or paste is kept as written.
- **Tools**: Draw (default) · Select (only selects by tapping or dragging; unlock the padlock next to it to drag selected notes) · Eraser · Scissors (cuts a note where you tap)
- **Layer**: draws only the Selected track, the same Score, or All tracks in the roll. Notes of other tracks appear faded; with "Click other tracks' notes to switch" on, clicking one switches to that track.
- Clicking a note highlights its place in the MML text; double-clicking lets you type there right away.
- Moving around: wheel (time) · Shift+wheel (pitch) · Ctrl+wheel (zoom time) · Ctrl+Shift+wheel (key height) · Fit all button
- The buttons in the lower-right corner of the roll also zoom (time −/+, key height −/+) and fit all (in the vertical roll, at the right just above the keyboard strip). They stay faint until you hover them; on a very narrow screen, use key height −/+ from the toolbar or the ⋯ menu
- Turn on Settings → Display → **Note volume numbers** to show the volume above the selected track's notes, like `v12` (to the right of the note start in the vertical roll). **Changes only** writes it on notes whose volume differs from the previous note and on the first note on screen; **All notes** writes it on every note. Notes tied with `&` after the first are skipped, and overlapping numbers are skipped when crowded (zoom in to see them)
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

- Click on a string to place the cursor, then **type the fret number** (0 to 24; two digits in a row), move with the arrow keys, delete with Delete
- When the cursor moved by keyboard or the fret pad goes off screen, the view scrolls with it (turn this on or off with View → **Follow cursor**; on by default)
- Click the **bar number row** at the top to play from that spot (while playing, playback continues from there; clicking the play position again clears it), or drag it to set a loop, as in the piano roll (on touch, drag with a finger). The play position and loop are shared with the piano roll, so they stay when you switch views. Assign a key to **Move play position to the edit cursor** in the key settings to move the play position to the tab cursor (no key by default)
- `+` / `-`: double / halve the cursor note (also sets the new-note length). On the fret pad, changing **New note** also changes the note at the cursor. Lengthening stops at the next note in the same track
- `.`: add or remove a dot on the selected notes, or with nothing selected on the cursor note (for a held note, the one at the cursor), e.g. quarter ↔ dotted quarter. With no cursor note either, it applies to the new-note length. The fret pad has a **.** button at the end of the note length pad
- Typing a fret over an existing note changes only its pitch, not its length
- `L`: tie to the note right after with & · `(5)` held · `5/7` slide. If nothing follows, adds the same pitch for the new-note length, tied (an eighth + L rings as a quarter)
- Chord notes at the same spot go into free tracks of the same score
- You can choose a tuning (Standard, Drop D, DADGAD, Baritone and more) and a capo
- On a PC (mouse) the zoom buttons are in the top toolbar (after Input v), as in the piano roll; on touch screens they are in the strip below the tab (next to the time scroll bar). Horizontal −/+ zooms time, and **Fit all** in the PC toolbar fits the whole song on screen (when the toolbar is narrow, `A−` / `A+` and the fretboard position are in the ⋯ menu)
- Turn on Settings → Display → **Note volume numbers** to add a `v` row at the bottom of the fretboard (below the × marks) that shows the volume of the selected track's notes, with the same rules as the piano roll. Numbers of selected notes are shown darker. Turn it off to remove the row
- Use `A−` / `A+` to change the tab size (string spacing and text), and the **fretboard position** button next to them (⤒ / ↕ / ⤓) to place the fretboard at the top, middle, or bottom of the area when there is spare height. Each click goes top → middle → bottom (middle by default), and the choice is remembered in this browser. While the fret pad is open, the fretboard always sits at the top
- With several tracks, each number is tinted with its track color and numbers from other tracks are dimmed (turn off in Settings → Display → Track colors on tab numbers)
- On touch, use the **Fret pad**. Pick the length of new notes in **New note** at the top of the pad (Grid / l4 / l8 / triplets…, the same setting as New note in the toolbar). With "Advance after entering" on, the cursor moves on by that length
- Above the fret numbers is the **note length pad**, one row (Grid / 1 / 2 / 4 / 8 / 16 / 32 / 64; swipe sideways if it does not fit). The pressed button is the new-note length, and a note at the cursor changes to it too. Add a dot with the **.** button at the end of the row. Triplet buttons (12, 24, 48) appear when you turn on Settings → Display → **Triplets on the note length pad**. A button for your tuplet (for example 20) appears at the end when you turn on Settings → Display → **Tuplet on the note length pad**. Settings → Display → **After tapping a fret on the tab pad** picks where the cursor goes: **Next slot** (default, by the entered length) or **Next string down (chord)** (same time, one string lower; stays put on the bottom string)
- Turn on View → **Tab fret pad** to open the fret pad when you click the fretboard with a mouse too (when off, only touch and pen open it). The setting is remembered in this browser
- The event row at the top has two lanes, like the piano roll: **the upper lane is tempo, the lower lane is time signature and markers** (same order and colors as the piano roll). **Double-click** the upper lane (long-press on touch or pen) to add a tempo there (even at the very start of the song where 4/4 sits, the upper lane adds a tempo); double-click an empty spot in the lower lane to add a marker. On a tempo label it edits that tempo, and on a time signature label it edits the time signature (for a new time signature, edit a time signature label or use the **Meter** box in the toolbar). `Alt+B` works too (at the tab cursor, otherwise the edit cursor or the start of the song). Hovering over an empty spot shows the hint for that lane
- The toolbar **Meter** field also changes the time signature from the bar containing the tab cursor (with no tab cursor, the play cursor's bar or the start of the song)
- Markers added in the piano roll show in the lower lane (a song has one set of markers, shared by both views). **Double-click** a marker label (long-press on touch or pen) to open the marker dialog and rename or delete it. Long names show only their first 12 characters followed by …; hover to see the full name
- **Selecting notes**: `Shift+←/→` widens or narrows a time range from the cursor slot and selects every note that starts inside it, on any string or track (a whole vertical column). With the mouse, `Shift`+click (from the cursor to the clicked slot) or `Shift`+drag; `Ctrl+A` selects all notes of the tracks shown in the tab. On touch, turn on **Select** in the fret pad and tap the fretboard to widen the range (tap it again or press Esc to turn it off). Selected numbers are lightly tinted with the accent color; a click without `Shift`, the arrow keys or Esc clear the selection. While notes are selected, `Shift+↑/↓` moves them up or down an octave as in the piano roll and keeps the selection so you can press it again (or whatever keys you set for the octave commands)
- The Edit menu and shortcuts work on selected notes as in the piano roll: delete (Delete), cut, copy, paste, length ×2/½ (`+`/`-`; lengthening stops before the next unselected note), octave and volume up/down, tie (`L`), split (Alt+S, at the tab cursor) and glue (Alt+G). If an octave change makes a note unplayable on its string, the string is chosen again. With nothing selected, Delete, `L` and `+`/`-` act on the cursor note as before. Locked tracks are not changed and you are told
- **Copying and pasting chords**: copying in the tab keeps the split across tracks; pasting in the tab starts at the tab cursor (otherwise the original position) and puts the first layer in the first track, the next layer in the next track, and so on. If a track already has overlapping notes, a free track is used, and tracks are added up to the score's track limit if needed. If even one layer does not fit within the limit, nothing is pasted and you are told. Pasting overlapping chord notes into the piano roll is refused with a message (one track holds one note at a time)

### MIDI keys

Turn on File menu → **Connect MIDI keyboard** and connect a MIDI keyboard to use **step input**, one note at a time. Notes go at the play cursor (or the end of the selected track if there is none) with the **New note** length, and the input position moves on by that length. The time you hold a key is not recorded as the length.

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
| Length ×2 / ½ | Ctrl+] / Ctrl+[, + / - (numpad +/− too). With no notes selected, doubles / halves the new-note length (toolbar length picker). Notes you didn't select are never removed; a note is lengthened only up to the next one |
| Add/remove dot | `.` (numpad `.` too). Adds or removes a dot on the selected notes (quarter ↔ dotted quarter); with nothing selected, on the new-note length. Lengths that cannot be one token, such as triplets or tied lengths, are left as they are. Lengthening stops before the next unselected note, as with length ×2 |
| Exact length | Type an MML length (8, 8., 16..) or a fraction into the selected-note box in the status bar and press Enter. Fractions are in whole notes, so `1/7` is one seventh of a whole note. Only lengths that can be written exactly for the game as lengths 1–64 (up to one dot) joined with & are accepted; others (such as `1/100`) are not applied, and the reason is shown |
| Tie / untie | Alt+L |
| Split | Scissors tool, or Alt+S at the play cursor |
| Glue | Alt+G (makes touching notes of the same pitch one note for editing; different from tying with &) |
| Copy / cut / paste | Ctrl+C / Ctrl+X / Ctrl+V (pastes at the play cursor) |

**Arpeggio** (Edit menu): select notes in the piano roll and open it to spread their chords out in order. There are three styles. **Spread on one track** places the chord notes one after another on the selected track (chord-track notes can be removed or kept); **Roll (keep original lengths)** keeps the original chord notes and only delays their starts in order; **Repeat across tracks** plays again every note length, cycling through the score's tracks (adding tracks within the track limit if needed). Chord notes come from notes starting together / selected notes only / a chord name (Major, Minor, 7, M7, m7, sus4, sus2, dim, aug, add9), and you pick the order (up, down, up and down, random), note length (including the triplets l3, l6, l12, l24, l48 and your tuplet, sorted by length), octave span (1–3), and repeat. Check the preview and apply; one undo reverts it. For notes starting together, tick the **Tracks in the chord** above the preview (the selected track is always in). From the first to the last start of the selected notes, every place where ticked tracks start notes together becomes a chord, so selecting a single note uses the whole chord at that place. A chord lasts until its latest-ending note, so a long bass note is not cut short.

- A **rolled chord** (the wavy line in guitar music) is **Roll + 64th**. No new notes are made: the original chord notes stay in place (same track, volume and tab string) and only their starts are delayed in order, each keeping its original end. **Up = low notes first** (from the guitar's 6th string), Down = high notes first. Roll ignores octave span and repeat and always takes notes starting together. Notes too short to delay are left as they are.
- Repeat across tracks makes new notes, but notes at the same pitch as an original note take its track, volume and tab string, and a chord whose original notes would be shortened is not made (you are told). Unticked tracks are neither read nor changed.
- It also works in the **tab view**: the notes selected in the tab, otherwise the **chord at the tab cursor** (notes of the same score starting there).

**Slide** (Edit menu): makes a guitar-like slide. **Between two notes** fills two adjacent notes with short in-between notes a semitone apart; **Slide in / Slide out** starts a note a few semitones below (or above) or falls off at its end. The notes are joined with `&`, so the pitch changes without re-striking. Pick the slide length and step length (Auto splits it to fit the game's shortest note length and skips semitones if needed). Places more than 24 semitones from the first note of the chain are not made, and you are warned when a long upward slide may cut off at the end of the sample. Each in-between note adds a few characters, so check the character count in the dialog.

**Add grace notes** (Edit menu): adds short grace notes before the selected notes (the main notes). In the piano roll it uses the selected notes; in Tab, the selected notes or, with nothing selected, the note at the cursor. Enter pitches separated by spaces: in Tab as fret numbers on the main note's string (for example `6 8` before a note on fret 6), in the piano roll as semitones from the main note (for example `-2` or `-1 +1`). One grace note is made per number. Pick the grace note length from l64, l48, l32, l24 and l16. MML has no zero-length grace notes, so one side really gets shorter. **On the beat** (default) puts the grace notes on the beat and starts the main note that much later; if the main note is a chord, the same player's chord notes on other tracks start later too, and other players are left alone. **Before the beat** keeps the main note on the beat and takes the time from the end of the previous note (or rest); it cannot be used on the first note of the song or when the previous note is too short. Shortened notes keep at least the game's shortest length (l64) and only lengths that can be written exactly are used, so the length list shows the most grace notes that fit (for example 7 at l64 on an eighth note), and more than that is refused. If you select chord notes on several tracks, the grace notes are added once, to the highest note. Turn on **Tie with &** (off by default) to join the grace notes and the main note with `&`, so the pitch changes without re-striking (like a hammer-on or pull-off). Notes that are tied into (not struck again) get no grace notes.

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

Song → Change time signature (the toolbar **Meter** field works the same). The change starts from the bar containing the play cursor (or from the start of the song if there is no cursor). In the tab view it starts from the bar containing the tab cursor. 6/8, 9/8 and 12/8 show three eighth notes as one beat.

### Tap tempo

Song → Tap tempo. Play the original (or a video) and press the **T** key or [Tap] **on the first beat of each bar**; the tempos are set when playback stops.

- If the first beat is hard to hear, switch to **Per beat** and tap along as if counting beats.
- **Smooth jitter** in the tap tempo bar (Light 30ms · Normal 60ms · Strong 100ms): taps that drift within the chosen range are treated as hand jitter and merged into one tempo. This also reduces the number of tempo commands and MML characters.

### Cleaning up tempos

- **Change all tempos**: sets every tempo in the song to one value (**All to**), shifts them all up or down (**± BPM**), or scales them by a percentage (**%**). With a loop range set, only the tempos inside it change and the tempo after the range stays as it was. The MML text of every score is updated too, and you are warned before anything leaves the game tempo range (t32–255). One Ctrl+Z undoes it. If a score has no place to put the range-edge tempo (only spots that would change its end length, or n notes that can't be split), that score's text is left as is and you are told which score it was.
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
- **On several tracks at once**: Ctrl+click tracks in the track list to add them. On touch, long-press a track and choose **Also draw volume on this track**, or tap **Volume ▾** on the lane (**n tracks** once several are in) and check the tracks. The melody track gets the drawn value as is, and the other tracks get the offsets set for the top, middle and bottom positions. Without a melody mark, the first track of the score is the melody.
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
  - The Tab view shows the same waveform strip under the tempo/meter row. Click it to jump there, or drag an empty part to slide the original (it is hidden while the fret pad is open, to leave room for the fretboard).

### Background video

Toolbar ⋯ → **Background video…** (in the piano roll). Put a falling-note video (such as a piano performance video) behind the piano roll and enter notes while watching it.

- **Align to keys**: set the video's leftmost and rightmost keys and the keyboard line so they line up with the roll's keys. Turn on **Drag to align** to adjust by dragging on the roll.
- **Fit roll**: moves and zooms the roll to the video's key range.
- Adjust Opacity, Offset (s), Time stretch and Video sound.
- **Fill screen** (on by default): sets Time stretch automatically so that the video from the keyboard line to its top edge covers the whole visible time axis of the roll. Turn it off to set Time stretch yourself.
- **Match speed**: measures how fast notes fall in the paused video and sets the roll's horizontal zoom to match, so video notes and roll notes reach the keyboard line together during playback. If it can't measure automatically, use **Measure by hand** and tap the front edge of one note twice. While measuring, the song can't be edited (saving still works); press Esc or **Cancel** to stop. If the tempo changes partway through the song, match again there.
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

1. **Distribute chords**: moves notes from tracks over the limit into free tracks of the same player. They stay on the same instrument, so the notes are kept as they are. (When the score has several tracks of the same instrument.) If tracks are still over the limit after distributing, **Add a track and distribute again** in the preview adds one empty track to the same score. If the score's tracks are already full, adding a track creates one more score for the same instrument (one more person plays in game), so use Split into score books to play it alone.
2. **Shrink MML**: rewrites the MML of every track shorter while keeping each note's pitch, start and length. Your own spaces, line breaks and comments are lost. If shrinking would drop notes, nothing is changed and you are told.
3. **Split into score books**: cuts all tracks at the same point into several books.
   - **Distribute chords before splitting** (on by default): before splitting, moves notes between tracks of the same instrument to even out channel lengths. If every channel then fits the limit, no split is needed; if it saves books, the split uses the moved result. The song you are editing stays as it is; "Apply to song" moves the notes in the song too (undo with Ctrl+Z). When off, only the book split runs, and a "N → M books" hint appears if moving notes would help.
   - **Thorough split** (off by default): at each book end, follows several more cut points near the limit to find a split with fewer books. It takes longer, so the stage and a progress bar show at the bottom while it runs. Short songs always get the exact fewest books even without this option.
   - Places where everyone rests are chosen first.
   - Octave, volume and tempo are written again at the start of each book.
   - Each book ends early by the delay before the next one starts (about 1 second) to keep the beat. Notes in that stretch can be shortened or dropped. Check "notes cut at the end" and the length warnings in the result, and listen around the book boundaries before using it.

For Distribute chords and Shrink MML, check the character counts before and after in the **preview**, then apply. Applied changes can be undone with Ctrl+Z. Split into score books does not change the original song; it only makes the output for each book. Use the per-score copy buttons in each book.

### Merge chords

When you import MIDI, notes from moments where the chord briefly grows can leave tracks with only a few scattered notes. Song menu → **Merge chords** moves those notes into a track of the same score and instrument that is resting at that moment, and removes tracks that end up empty (if the song has more than one score and removing a track would pull later tracks into an earlier score, the empty track is kept instead). The sound stays the same and no note is dropped or shortened.

- Notes that overlap other tracks have nowhere to go and stay where they are.
- A note is not put into a track whose neighbouring notes are more than a perfect fifth away (so the line doesn't jump), or where it would become tied with &.
- Notes are not moved if the receiving track would newly go over the character limit. When a track can't be emptied and only some notes move, they move only if the total character count doesn't grow, so quieter fragments with a different v may stay.
- Locked tracks, and tracks that differ in mute, solo or channel volume, are left alone.
- Check the character counts before and after in the preview, then apply. Undo with Ctrl+Z.

In Settings → **Chords** you choose Merge chords when importing MIDI (on by default) and Distribute chords before splitting into score books (on by default).

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
5. **Merge chords** (on by default): moves notes from moments where the chord briefly grows into a resting track of the same instrument, so they don't end up in a track of their own (see Merge chords in section 9). Runs before Fill empty channels.
6. **Fill empty channels**: puts chord notes dropped by compression back into resting channels. If this goes over the character limit, the added notes are removed first.
7. Check the summary at the bottom (dropped notes, notes put back, merged notes, longest channel's character count) and click **Import**.

Importing MIDI does not copy the original exactly. Notes beyond the chord count are dropped, and note lengths are adjusted to the grid. Listen after importing and fix what needs fixing.

---

## 11. Saving and file formats

| Format | Menu | When |
|---|---|---|
| **Project .mme** | Save project (Ctrl+S) | **Recommended for keeping your work and moving it to another device.** Keeps fractional positions, track structure and editor state (older .mmlce files also open) |
| 3MLE .mml | Save as 3MLE (Ctrl+Alt+S) | To open in 3MLE. The default is CP949, and characters it lacks become ?, so save as UTF-8 if needed |
| MabiIcco .mmi | Save as MabiIcco (Ctrl+Shift+S) | To open in MabiIcco. You are told about notes that do not fit its grid (96 per quarter note) |
| MIDI .mid | Save as MIDI | For DAWs and similar. Instruments become GM programs, and bass drum and cymbal go on the drum channel. Extra soundpack instruments written only as a number (#42.3 etc.) get the GM program of the instrument found in the loaded pack, and pitches stay as written. Notes of different pitches tied with `&` are saved as separate notes in MIDI |
| WAV | Save as WAV | Renders the whole song with the current sound packs into an audio file (mute and solo as heard). Needs a sound pack |
| MML@ text | Put in game | For pasting into the game |

### Where files are saved

Set this in Settings → **Saving**.

- Chrome and Edge on a PC: the default is **Choose folder and name each time**. As when opening a file, a save dialog opens so you pick the folder and file name, and the next save starts in the folder you used last. For a WAV, press the **Save** button that appears once it is rendered.
- With this setting, once you save a project (.mme) (or open a project with **Open score**), the next save (Ctrl+S) writes straight to the same file without a dialog. For an opened file, the first save asks once for permission to write. To save to a new file, pick File → **Save as…** (you can give it a shortcut in the key settings). If the file was moved or deleted and cannot be written, the save dialog opens again. On iPad and Safari, browser limits mean every save goes through the share sheet or downloads.
- Chrome and Edge on a PC: pick **Save straight to a set folder** and choose a folder, and every saved file goes there without asking. A file with the same name is overwritten, except that an unnamed new song is saved under a new name such as `new project 2` and keeps that name for later saves. After the browser restarts, the first save may ask you to allow the folder again. Pick **Downloads folder** to save through browser downloads.
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
| Display | Theme (Follow system · Light · Dark), Accent color, Note look (Rounded corners · Border · Shade by v · Note names when zoomed in), Note volume numbers (Off · Changes only · All notes), Track colors (By position in score · Hue per score · Saved in file), MML editor text and text size, Roll during playback (Turn pages · Scroll continuously), Maximum editors (the most you can pick in View → Editors, 2 up to the tracks in one score, 4 by default) |
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
| | Ctrl+A | Select all notes in the current track (in the tab, all tracks shown) |
| | Ctrl+C / X / V | Copy / cut / paste |
| | Delete, Backspace | Delete selected notes |
| | Ctrl+] / Ctrl+[, + / - | Length ×2 / ½ (new-note length when nothing is selected) |
| | . | Add / remove dot (new-note length when nothing is selected) |
| | Alt+P | Transpose |
| Note | Shift+↑ / ↓ | Octave up / down |
| | Alt+↑ / ↓ | Volume up / down |
| | Alt+L | Tie or untie to the next note with & |
| | Alt+S | Split at the play cursor (in the tab, at the tab cursor) |
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

- **Panel beside** is the default for touch. In portrait on iPad (or a tall PC window), the screen is split top and bottom, and **Structure | MML** in the panel header picks which one you see. In MML, switch tracks from the track strip above the editor.
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
