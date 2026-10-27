/**
 * basic-pitch의 MIDI 파일 만들기(@tonejs/midi)는 쓰지 않는다: BiNote는 받아 적은 음을 @mmlce/midi로 MIDI로 만든다.
 * vite.config의 별칭이 "@tonejs/midi"를 이 빈 자리로 바꿔 받아 적기 조각을 줄인다
 */
export class Midi {
  constructor() {
    throw new Error("@tonejs/midi is not bundled");
  }
}
