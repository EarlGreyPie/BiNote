# BiNote

[한국어](README.md) · English · [日本語](README.ja.md)

BiNote is an MML score editor for Mabinogi Mobile. You write MML on a piano roll or a tab view.
Each chord voice is its own track. You can listen with several soundpacks, and optimize or split the MML to fit the game limits (characters and chords per score).

Scores for **Mabinogi** (the PC game) may have some **compatibility problems**. See "Compatibility" below.

- Form: TypeScript web app + PWA (Windows, iPad, Android)
- Input: piano roll, tab
- Tools: keyboard, mouse, touch
- Made by: EarlGreyPie

> This is an **unofficial, personal fan-made tool**. It is not related to Nexon or Mabinogi Mobile. The rights to the game name, instrument names and sounds belong to Nexon.

## Before you start

- **Soundpack**: You can edit scores without a soundpack. To hear sound, get a Mabinogi soundpack (.dls) yourself and load it in the app. Soundpacks are Nexon assets, so BiNote does not include them and this repository does not distribute them.
- **Storage**: Songs and soundpack files are not uploaded to any server. They stay in the browser on your device. The app has no analytics or ad scripts. Browser cleanup can delete them, so save songs you want to keep as a project (.mme) file.
- **Languages**: 한국어, English, 日本語, 繁體中文, 简体中文.
- **Translation**: Translations other than Korean are not fully reviewed by people. Some names, such as instruments whose official names we could not find on the Japan and Taiwan servers, are temporary. Please report wrong or awkward text with "Translation report" in the [issues](../../issues/new/choose). Official in-game names are a great help.

## How to use

The [guidebook](docs/guide/en.md) covers the screen, entering notes, exporting MML, file formats and shortcuts.

## Beta program

Beta address: [beta.binote.pages.dev](https://beta.binote.pages.dev)

BiNote runs a separate beta page to test new features.
New features are tested on the beta page for a while before they reach the main page.

- The beta page has features still being tested, so it may be unstable. Save important songs as project (.mme) files.
- The beta page and the main page have separate storage. Songs and soundpacks on one are not visible on the other, so to move them, save to a file and open it again on the other page.
- If you find a problem on the beta page, please report it with [Beta bug report](../../issues/new?template=beta.yml). It helps development a lot.

## Questions and contributions

- Please report problems and translation errors in the [issues](../../issues/new/choose). Include the version shown at the bottom of Settings. Do not attach soundpack files.
- Feature ideas are also welcome as issues. Code pull requests are not accepted for now.

## Files

- **Project (.mme)**: BiNote's own format. Use it to keep your work.
- **Compatible formats**: 3MLE .mml, MabiIcco .mmi, MIDI, and the `MML@` text you paste into the game.

## Compatibility

Some scores (tuplets) may not carry over correctly to Mabinogi (PC). We do not recommend BiNote for complex scores made for Mabinogi (PC).

> Mabinogi uses whole-number ticks. Mabinogi Mobile also accepts fractional lengths, and BiNote is designed around fractions. Because of this, some MML may give errors in tools or games that use whole-number ticks.

## About development

- Planning, in-game measurement, QA: EarlGreyPie
- Code: Claude
- Code review: GPT
- Game behavior follows values we recorded and measured in the game ourselves.

**Relation to existing tools**

- BiNote does not use code from the existing editors 3MLE or MabiIcco (mmlTools). Only their behavior and features were used as a reference during development.
- BiNote calculates lengths differently from those tools. We tried to keep compatibility, but it is not perfect. If you find a problem, please open a GitHub issue.

Build steps and the package layout are in the [Korean README](README.md#개발).

## License

BiNote is released under the [GNU GPL v3](LICENSE) (GPL-3.0-only). If you distribute a modified version, you must release its source under the same license.

- Notices for bundled libraries (SpessaSynth Apache-2.0, CodeMirror, Svelte and VexFlow MIT, and others) are in [`apps/web/public/licenses/third-party.txt`](apps/web/public/licenses/third-party.txt). Font notices (OFL) are in [`fonts.txt`](apps/web/public/licenses/fonts.txt).
- The rights to game assets such as Mabinogi Mobile soundpacks and instrument names belong to Nexon. They are not in this repository.
