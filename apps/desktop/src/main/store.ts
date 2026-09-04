/**
 * JSON 파일 저장소. `@pet/meta`의 `MetaStore`와 `@pet/room`의 `RoomStore`를 함께 채운다.
 *
 * 팀 결정: 별도 서버와 DB를 두지 않고 사용자 기기에 저장한다. 그래서 앱 데이터
 * 디렉터리에 파일 하나를 쓴다.
 *
 * ## 왜 임시 파일에 쓰고 이름을 바꾸는가
 *
 * 파일을 직접 열어 덮어쓰면, 쓰는 도중에 앱이 죽거나 전원이 나갔을 때 **반쪽짜리 JSON이
 * 남는다.** 그러면 다음 실행에서 파싱이 실패하고 사용자는 펫과 업적을 통째로 잃는다.
 *
 * 임시 파일에 완전히 쓴 뒤 `rename`으로 갈아 끼우면, 같은 파일 시스템 안에서 이름 바꾸기는
 * 원자적이라 중간 상태가 존재하지 않는다. 실패해도 **직전 정상 파일이 그대로 남는다.**
 *
 * ## 깨진 파일을 만나면
 *
 * 조용히 지우지 않는다. `.corrupt-<시각>`으로 옮겨 두고 새로 시작한다. 사용자가 잃은
 * 데이터를 나중에 복구할 여지를 남기고, 버그 리포트에 첨부할 수 있게 하기 위해서다.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PortError } from '@pet/meta';

/**
 * 저장 파일은 feature마다 하나씩 둔다.
 *
 * meta와 room을 한 파일에 합치면 한쪽의 스키마를 고칠 때 다른 쪽이 딸려 나가고, 한쪽이
 * 깨지면 둘 다 격리된다. 저장 주기와 변경 이유가 다른 것을 같은 파일에 두지 않는다.
 */
export const META_FILE_NAME = 'meta-state.json';
export const ROOM_FILE_NAME = 'room-state.json';

/**
 * 스냅샷 한 덩어리를 파일 하나에 담는다.
 *
 * 타입 매개변수만 다를 뿐 저장 규칙은 같으므로 구현을 공유한다. `MetaStore`와
 * `RoomStore` 둘 다 `load`/`save` 두 메서드뿐이라, 이 클래스가 구조적으로 둘 다 만족한다.
 */
export class JsonFileStore<T> {
  readonly path: string;

  constructor(directory: string, fileName: string) {
    this.path = join(directory, fileName);
  }

  get #tempPath(): string {
    return `${this.path}.tmp`;
  }

  /** 깨진 파일을 옆으로 치운다. 실패해도 로딩 자체를 막지는 않는다. */
  #quarantine(reason: string): void {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = `${this.path}.corrupt-${stamp}`;
    try {
      renameSync(this.path, target);
      console.log(`[STORE] 깨진 저장 파일을 ${target}로 옮겼습니다 — ${reason}`);
    } catch (error) {
      console.log(`[STORE] 깨진 저장 파일을 옮기지 못했습니다 — ${String(error)}`);
    }
  }

  load(): T | undefined {
    let raw: string;
    try {
      raw = readFileSync(this.path, 'utf8');
    } catch (error) {
      // 파일이 없는 것은 오류가 아니라 새 설치다.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new PortError(`저장 파일을 읽지 못했어요: ${String(error)}`);
    }

    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      this.#quarantine(String(error));
      // 새로 시작한다. 여기서 던지면 앱이 아예 못 뜬다.
      return undefined;
    }
  }

  save(snapshot: T): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
    } catch (error) {
      throw new PortError(`저장 폴더를 만들지 못했어요: ${String(error)}`);
    }

    const json = JSON.stringify(snapshot, null, 2);

    try {
      writeFileSync(this.#tempPath, json, 'utf8');
    } catch (error) {
      throw new PortError(`저장하지 못했어요: ${String(error)}`);
    }

    // 원자적 교체. 여기서 실패하면 직전 정상 파일이 그대로 남는다.
    try {
      renameSync(this.#tempPath, this.path);
    } catch (error) {
      rmSync(this.#tempPath, { force: true });
      throw new PortError(`저장 파일을 바꾸지 못했어요: ${String(error)}`);
    }
  }
}
