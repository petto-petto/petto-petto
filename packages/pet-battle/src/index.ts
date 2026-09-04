/**
 * # @pet/battle
 *
 * 전투 feature의 수직 슬라이스다. Rust가 XP·정복·진행도·모션 상태를 소유하고,
 * TypeScript는 JSON-lines IPC와 Electron 화면 계약만 소유한다. Electron 앱은 이 패키지의
 * 핸들러를 등록하고 UI 파일을 로드할 뿐이며 전투 규칙을 알 필요가 없다.
 */

export * from './contracts.ts';
export * from './view/scene.ts';
export * from './ipc/client.ts';
export * from './ipc/sidecar.ts';
export * from './app/handlers.ts';
