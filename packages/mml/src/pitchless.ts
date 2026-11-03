import { trackInstrument, type GameProfile, type Song, type Track } from "@mmlce/core";

/**
 * 게임에 넣을 글을 쓸 때만: 높이를 바꿔도 같은 소리인 악기(profile.pitchlessInstruments, 큰북·심벌즈) 트랙의 음을
 * 모두 한 높이(profile.percussionPitch, o4c)로 바꾼 곡. o4는 기본 옥타브라 o·<·> 명령과 +·-가 모두 빠져 글자가 준다.
 * 편집 중인 곡·저장 파일(.mme·3MLE)은 바꾸지 않는다 (게임에 넣기·MML로 내보내기·악보책 나누기에만 쓴다).
 * 바꿀 트랙이 없으면 받은 곡 그대로, 있으면 바꾼 트랙만 새 객체다. 같은 트랙은 같은 새 트랙을 돌려준다
 * (게임 글 캐시가 트랙 객체로 찾으므로 부를 때마다 새로 만들면 다시 쓰기를 거듭한다)
 */
export function pitchlessForOutput(song: Song, profile: GameProfile): Song {
  const list = profile.pitchlessInstruments;
  if (list.length === 0) return song;
  const pitch = profile.percussionPitch;
  let changed = false;
  const tracks = song.tracks.map((t) => {
    if (!list.includes(trackInstrument(song, t).canonical) || t.notes.every((n) => n.pitch === pitch)) return t;
    const key = `${pitch}`;
    const hit = memo.get(t);
    if (hit && hit.key === key) {
      changed = true;
      return hit.track;
    }
    const track: Track = { ...t, notes: t.notes.map((n) => (n.pitch === pitch ? n : { ...n, pitch })) };
    memo.set(t, { key, track });
    changed = true;
    return track;
  });
  return changed ? { ...song, tracks } : song;
}

const memo = new WeakMap<Track, { key: string; track: Track }>();
